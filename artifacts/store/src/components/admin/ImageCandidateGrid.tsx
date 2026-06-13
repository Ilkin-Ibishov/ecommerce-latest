import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProxyUrl } from "@/lib/image-proxy";

export interface ImageCandidateGridProps {
  candidates: string[];
  selectedUrls: string[];
  existingUrls: string[];
  remainingSlots: number;
  onSelectionChange: (selected: string[]) => void;
}

/**
 * Selectable grid of candidate images from search/barcode results.
 *
 * - Displays image previews in a responsive grid (3 cols mobile, 4 md, 5 lg)
 * - Supports multi-select with checkmark overlay
 * - Respects remaining slot limit — disables selection beyond available slots
 * - Greys out URLs already added to product
 */
export function ImageCandidateGrid({
  candidates,
  selectedUrls,
  existingUrls,
  remainingSlots,
  onSelectionChange,
}: ImageCandidateGridProps) {
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  const selectionLimitReached = selectedUrls.length >= remainingSlots;

  function handleClick(url: string) {
    // Already added to product — not clickable
    if (existingUrls.includes(url)) return;

    const isSelected = selectedUrls.includes(url);

    if (isSelected) {
      // Deselect
      onSelectionChange(selectedUrls.filter((u) => u !== url));
    } else {
      // Can only select if we haven't reached the limit
      if (!selectionLimitReached) {
        onSelectionChange([...selectedUrls, url]);
      }
    }
  }

  function handleImageError(url: string) {
    setFailedUrls((prev) => new Set(prev).add(url));
  }

  if (candidates.length === 0) return null;

  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
      {candidates.map((url) => {
        const isExisting = existingUrls.includes(url);
        const isSelected = selectedUrls.includes(url);
        const isDisabled = !isSelected && !isExisting && selectionLimitReached;
        const hasFailed = failedUrls.has(url);

        return (
          <button
            key={url}
            type="button"
            onClick={() => handleClick(url)}
            disabled={isExisting || isDisabled}
            className={cn(
              "relative aspect-square rounded-md border overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all",
              isSelected && "border-blue-500 border-2 ring-2 ring-blue-500/30",
              isExisting && "opacity-50 cursor-not-allowed grayscale",
              isDisabled && "opacity-40 cursor-not-allowed",
              !isSelected && !isExisting && !isDisabled && "border-border hover:border-blue-300 cursor-pointer"
            )}
          >
            {/* Image */}
            {hasFailed ? (
              <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground text-xs">
                Failed
              </div>
            ) : (
              <img
                src={getProxyUrl(url, "thumbnail")}
                alt="Candidate image"
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => handleImageError(url)}
              />
            )}

            {/* Selected checkmark overlay */}
            {isSelected && (
              <div className="absolute top-1 right-1 bg-blue-500 text-white rounded-full p-0.5">
                <Check className="w-3.5 h-3.5" />
              </div>
            )}

            {/* Already added badge */}
            {isExisting && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="bg-black/60 text-white text-xs font-medium px-2 py-0.5 rounded">
                  Added
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
