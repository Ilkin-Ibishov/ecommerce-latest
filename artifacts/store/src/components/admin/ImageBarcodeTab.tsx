import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { ImageCandidateGrid } from "./ImageCandidateGrid";

export interface ImageBarcodeTabProps {
  productId: string;
  existingUrls: string[];
  remainingSlots: number;
  onImagesSelected: (urls: string[]) => void;
}

/**
 * Validates barcode format client-side.
 * Accepts EAN-8 (8 digits), UPC-A (12 digits), EAN-13 (13 digits).
 * UPC-E is also 8 digits so covered by the 8-digit case.
 */
function isValidBarcodeFormat(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  return value.length === 8 || value.length === 12 || value.length === 13;
}

type ErrorType = "invalid_format" | "rate_limit" | "no_results" | "server_error" | null;

/**
 * Barcode lookup tab for the Admin Image Panel.
 *
 * - Input field with client-side barcode format validation (digits only, length 8/12/13)
 * - Calls POST /api/admin/products/:id/images/barcode with { barcode }
 * - Displays results in ImageCandidateGrid
 * - Shows specific errors for invalid format, rate limit exceeded, no results, and server errors
 */
export function ImageBarcodeTab({
  productId,
  existingUrls,
  remainingSlots,
  onImagesSelected,
}: ImageBarcodeTabProps) {
  const [barcode, setBarcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [errorType, setErrorType] = useState<ErrorType>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const trimmed = barcode.trim();
  const isValid = isValidBarcodeFormat(trimmed);
  const showFormatError = trimmed.length > 0 && !isValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || loading) return;

    setLoading(true);
    setErrorType(null);
    setCandidates([]);
    setSelectedUrls([]);
    setHasSearched(true);

    try {
      const response = await fetch(apiUrl(`/admin/products/${productId}/images/barcode`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({ barcode: trimmed }),
      });

      if (response.status === 429) {
        setErrorType("rate_limit");
        return;
      }

      if (!response.ok) {
        setErrorType("server_error");
        return;
      }

      const data = await response.json();
      const images: string[] = data.images ?? [];

      if (images.length === 0) {
        setErrorType("no_results");
      } else {
        setCandidates(images);
      }
    } catch {
      setErrorType("server_error");
    } finally {
      setLoading(false);
    }
  }

  function handleAddSelected() {
    if (selectedUrls.length > 0) {
      onImagesSelected(selectedUrls);
      setSelectedUrls([]);
      setCandidates([]);
      setHasSearched(false);
    }
  }

  function handleRetry() {
    setErrorType(null);
    handleSubmit(new Event("submit") as unknown as React.FormEvent);
  }

  return (
    <div className="space-y-4">
      {/* Barcode input form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1">
          <input
            type="text"
            value={barcode}
            onChange={(e) => {
              setBarcode(e.target.value);
              if (errorType === "invalid_format") setErrorType(null);
            }}
            placeholder="Enter EAN/UPC barcode..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            disabled={loading}
          />
          {showFormatError && (
            <p className="text-destructive text-xs mt-1">
              Please enter a valid EAN-8, EAN-13, UPC-A, or UPC-E barcode
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={!isValid || loading || remainingSlots === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Lookup"
          )}
        </button>
      </form>

      {/* Error states */}
      {errorType === "rate_limit" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Barcode lookup limit reached. Please try again tomorrow
        </div>
      )}

      {errorType === "no_results" && (
        <div className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          No images found for this barcode
        </div>
      )}

      {errorType === "server_error" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-center justify-between">
          <span>Barcode lookup is temporarily unavailable</span>
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-900"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Results grid */}
      {candidates.length > 0 && (
        <div className="space-y-3">
          <ImageCandidateGrid
            candidates={candidates}
            selectedUrls={selectedUrls}
            existingUrls={existingUrls}
            remainingSlots={remainingSlots}
            onSelectionChange={setSelectedUrls}
          />

          {selectedUrls.length > 0 && (
            <button
              type="button"
              onClick={handleAddSelected}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Add selected ({selectedUrls.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
