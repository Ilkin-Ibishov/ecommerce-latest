import { useState, useEffect, useCallback } from "react";
import { Search, Barcode, Link, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api";
import { ImageGrid, type ProductImage } from "./ImageGrid";
import { ImageSearchTab } from "./ImageSearchTab";
import { ImageBarcodeTab } from "./ImageBarcodeTab";
import { ImagePasteTab } from "./ImagePasteTab";
import { ImageUploadTab } from "./ImageUploadTab";

export interface ProductImagePanelProps {
  productId: string;
}

type TabId = "search" | "barcode" | "paste" | "upload";

const MAX_IMAGES = 5;

const TABS: { id: TabId; label: string; icon: typeof Search }[] = [
  { id: "search", label: "Search", icon: Search },
  { id: "barcode", label: "Barcode", icon: Barcode },
  { id: "paste", label: "Paste", icon: Link },
  { id: "upload", label: "Upload", icon: Upload },
];

/**
 * Main orchestrator panel for managing product images.
 *
 * - Fetches current images on mount
 * - Displays image count and remaining slots (e.g., "3/5 images")
 * - Renders ImageGrid for existing images with reorder/delete
 * - Tab navigation: Search, Barcode, Paste, Upload
 * - Disables all image-adding controls when product has 5 images
 * - Wires tab results to POST endpoint, then refreshes
 */
export function ProductImagePanel({ productId }: ProductImagePanelProps) {
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("search");

  const imageCount = images.length;
  const remainingSlots = Math.max(0, MAX_IMAGES - imageCount);
  const isAtMax = imageCount >= MAX_IMAGES;
  const existingUrls = images.map((img) => img.url);

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/admin/products/${productId}/images`), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setImages(data.images ?? []);
      }
    } catch {
      // Silently fail — images will show as empty
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  /**
   * Called by Search and Barcode tabs when the admin selects images.
   * Posts each URL sequentially then refreshes the list.
   */
  async function handleImagesSelected(urls: string[], source: "search" | "barcode") {
    for (const url of urls) {
      await fetch(apiUrl(`/admin/products/${productId}/images`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({ url, source }),
      });
    }
    await fetchImages();
  }

  /** Called by Paste and Upload tabs after they successfully add an image. */
  function handleImageAdded() {
    fetchImages();
  }

  /** Called by ImageGrid after reorder or delete. */
  function handleGridChange() {
    fetchImages();
  }

  return (
    <div className="space-y-4">
      {/* Header with image count */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Product Images</h3>
        <span
          className={cn(
            "text-sm font-medium",
            isAtMax ? "text-primary" : "text-muted-foreground"
          )}
        >
          {imageCount}/{MAX_IMAGES} images
          {isAtMax && (
            <span className="ml-1 text-xs text-amber-600">(max)</span>
          )}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isAtMax ? "bg-primary" : "bg-blue-500"
          )}
          style={{ width: `${(imageCount / MAX_IMAGES) * 100}%` }}
        />
      </div>

      {/* Image grid — existing images with reorder/delete */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
          Loading images...
        </div>
      ) : (
        <ImageGrid
          productId={productId}
          images={images}
          onReorder={handleGridChange}
          onDelete={handleGridChange}
        />
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              disabled={isAtMax}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                isAtMax && "opacity-50 cursor-not-allowed"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      {!isAtMax && (
        <div>
          {activeTab === "search" && (
            <ImageSearchTab
              productId={productId}
              existingUrls={existingUrls}
              remainingSlots={remainingSlots}
              onImagesSelected={(urls) => handleImagesSelected(urls, "search")}
            />
          )}
          {activeTab === "barcode" && (
            <ImageBarcodeTab
              productId={productId}
              existingUrls={existingUrls}
              remainingSlots={remainingSlots}
              onImagesSelected={(urls) => handleImagesSelected(urls, "barcode")}
            />
          )}
          {activeTab === "paste" && (
            <ImagePasteTab
              productId={productId}
              existingUrls={existingUrls}
              remainingSlots={remainingSlots}
              onImageAdded={handleImageAdded}
            />
          )}
          {activeTab === "upload" && (
            <ImageUploadTab
              productId={productId}
              remainingSlots={remainingSlots}
              onImageAdded={handleImageAdded}
            />
          )}
        </div>
      )}

      {/* Max images message */}
      {isAtMax && (
        <p className="text-center text-sm text-muted-foreground py-4">
          Maximum images reached. Remove an image to add more.
        </p>
      )}
    </div>
  );
}
