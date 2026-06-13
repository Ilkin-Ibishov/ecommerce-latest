import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { ImageCandidateGrid } from "./ImageCandidateGrid";

export interface ImageSearchTabProps {
  productId: string;
  existingUrls: string[];
  remainingSlots: number;
  onImagesSelected: (urls: string[]) => void;
}

/**
 * Text search input and candidate image grid.
 *
 * - Input field with min 2 chars validation
 * - Calls POST /api/admin/products/:id/images/search with { query }
 * - Displays results in ImageCandidateGrid
 * - Shows loading, empty, and error states
 * - "Add selected" button calls onImagesSelected with chosen URLs
 */
export function ImageSearchTab({
  productId,
  existingUrls,
  remainingSlots,
  onImagesSelected,
}: ImageSearchTabProps) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const isQueryValid = query.trim().length >= 2;

  async function handleSearch() {
    if (!isQueryValid) return;

    setLoading(true);
    setError(null);
    setCandidates([]);
    setSelectedUrls([]);
    setHasSearched(true);

    try {
      const res = await adminFetch(
        apiUrl(`/admin/products/${productId}/images/search`),
        {
          method: "POST",
          body: JSON.stringify({ query: query.trim() }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Search failed (${res.status})`);
      }

      const data = await res.json();
      setCandidates(data.images ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && isQueryValid && !loading) {
      handleSearch();
    }
  }

  function handleAddSelected() {
    if (selectedUrls.length > 0) {
      onImagesSelected(selectedUrls);
      setSelectedUrls([]);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search for product images..."
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          disabled={loading}
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={!isQueryValid || loading}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          Search
        </button>
      </div>

      {/* Validation hint */}
      {query.length > 0 && query.trim().length < 2 && (
        <p className="text-xs text-muted-foreground">
          Please enter at least 2 characters
        </p>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Searching...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-center">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <button
            type="button"
            onClick={handleSearch}
            className="text-sm font-medium text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && hasSearched && candidates.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">
          No images found
        </p>
      )}

      {/* Results grid */}
      {!loading && candidates.length > 0 && (
        <>
          <ImageCandidateGrid
            candidates={candidates}
            selectedUrls={selectedUrls}
            existingUrls={existingUrls}
            remainingSlots={remainingSlots}
            onSelectionChange={setSelectedUrls}
          />

          {/* Add selected button */}
          {selectedUrls.length > 0 && (
            <button
              type="button"
              onClick={handleAddSelected}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Add selected ({selectedUrls.length})
            </button>
          )}
        </>
      )}
    </div>
  );
}
