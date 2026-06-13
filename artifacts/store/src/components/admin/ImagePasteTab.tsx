import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { getProxyUrl } from "@/lib/image-proxy";

export interface ImagePasteTabProps {
  productId: string;
  existingUrls: string[];
  remainingSlots: number;
  onImageAdded: () => void;
}

/**
 * URL paste tab for the admin image panel.
 *
 * Allows an admin to paste an image URL, preview it, and add it
 * as a product image with source='paste'.
 */
export function ImagePasteTab({
  productId,
  existingUrls,
  remainingSlots,
  onImageAdded,
}: ImagePasteTabProps) {
  const [url, setUrl] = useState("");
  const [previewVisible, setPreviewVisible] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const disabled = remainingSlots === 0;

  function validateUrl(value: string): string | null {
    if (!value.trim()) return null;
    if (!value.startsWith("https://")) return "Only HTTPS URLs are supported";
    if (existingUrls.includes(value)) return "This image is already added";
    return null;
  }

  function handleUrlChange(value: string) {
    setUrl(value);
    setError("");
    setImageError(false);
    setPreviewVisible(false);

    const validationError = validateUrl(value);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Show preview if URL looks valid
    if (value.startsWith("https://")) {
      setPreviewVisible(true);
    }
  }

  function handleImageLoadError() {
    setImageError(true);
    setPreviewVisible(false);
    setError("This URL doesn't appear to be a valid image");
  }

  async function handleAdd() {
    const validationError = validateUrl(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (imageError) {
      setError("This URL doesn't appear to be a valid image");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch(apiUrl(`/admin/products/${productId}/images`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({ url, source: "paste" }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Failed to add image");
        return;
      }

      // Success — clear input and notify parent
      setUrl("");
      setPreviewVisible(false);
      setImageError(false);
      onImageAdded();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* URL input */}
      <div>
        <input
          type="text"
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="Paste image URL (https://...)"
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Disabled message */}
      {disabled && (
        <p className="text-sm text-muted-foreground">
          Maximum images reached (5/5). Remove an image to add more.
        </p>
      )}

      {/* Error message */}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Image preview */}
      {previewVisible && !imageError && url && (
        <div className="relative aspect-video max-w-xs rounded-md border border-border overflow-hidden bg-muted">
          <img
            src={getProxyUrl(url, "thumbnail")}
            alt="Preview"
            className="w-full h-full object-contain"
            onError={handleImageLoadError}
          />
        </div>
      )}

      {/* Add button */}
      <button
        type="button"
        onClick={handleAdd}
        disabled={disabled || submitting || !url.trim() || imageError || !!error}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? "Adding..." : "Add Image"}
      </button>
    </div>
  );
}
