import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProxyUrl } from "@/lib/image-proxy";

interface ProductImage {
  id: string;
  url: string;
  alt_text?: string | null;
  sort_order: number;
}

interface ProductGalleryProps {
  images: ProductImage[];
}

/**
 * ProxiedImage renders an image through the wsrv.nl proxy with an onError
 * fallback to the raw URL if the proxy fails.
 */
function ProxiedImage({
  src,
  preset,
  alt,
  className,
  loading,
  onClick,
}: {
  src: string;
  preset: "thumbnail" | "gallery" | "lightbox";
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  onClick?: () => void;
}) {
  const [imgSrc, setImgSrc] = useState(() => getProxyUrl(src, preset));

  // Reset src if the raw URL changes
  useEffect(() => {
    setImgSrc(getProxyUrl(src, preset));
  }, [src, preset]);

  const handleError = () => {
    // Fallback to raw URL on proxy failure
    if (imgSrc !== src) {
      setImgSrc(src);
    }
  };

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      loading={loading}
      onClick={onClick}
      onError={handleError}
      draggable={false}
    />
  );
}

/**
 * Full-screen lightbox overlay for desktop image viewing.
 * Uses the "lightbox" preset for high-resolution images.
 * Closes on backdrop click or Escape key.
 */
function Lightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: ProductImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const prev = useCallback(
    () => setCurrentIndex((i) => (i - 1 + images.length) % images.length),
    [images.length]
  );
  const next = useCallback(
    () => setCurrentIndex((i) => (i + 1) % images.length),
    [images.length]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, prev, next]);

  // Prevent body scroll while lightbox is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const current = images[currentIndex];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition"
        aria-label="Close lightbox"
      >
        <X size={20} />
      </button>

      {/* Navigation arrows (only for multi-image) */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition"
            aria-label="Previous image"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition"
            aria-label="Next image"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}

      {/* Lightbox image */}
      <div onClick={(e) => e.stopPropagation()}>
        <ProxiedImage
          src={current.url}
          preset="lightbox"
          alt={current.alt_text ?? ""}
          className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg"
          loading="eager"
        />
      </div>

      {/* Dot indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-4 flex gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(i);
              }}
              className={cn(
                "w-2.5 h-2.5 rounded-full transition",
                i === currentIndex ? "bg-white" : "bg-white/40"
              )}
              aria-label={`Go to image ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ProductGallery — Interactive product image gallery component.
 *
 * Features:
 * - Primary image displayed large with "gallery" proxy preset
 * - Thumbnail strip for multi-image products
 * - Click-to-select thumbnail
 * - Left/right swipe navigation on mobile (touch events)
 * - Lightbox on desktop click with "lightbox" preset
 * - Lazy-loads non-visible images
 * - Hides navigation controls for single-image products
 * - onError fallback to raw URL for proxy failures
 */
export default function ProductGallery({ images }: ProductGalleryProps) {
  // Sort images by sort_order to ensure primary is first
  const sortedImages = [...images].sort((a, b) => a.sort_order - b.sort_order);

  const [activeIndex, setActiveIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);

  // Touch tracking for swipe navigation
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  const hasMultipleImages = sortedImages.length > 1;
  const currentImage = sortedImages[activeIndex] ?? null;

  // Reset index when images change
  useEffect(() => {
    setActiveIndex(0);
  }, [images.length]);

  const goToPrev = useCallback(() => {
    setActiveIndex((i) => (i - 1 + sortedImages.length) % sortedImages.length);
  }, [sortedImages.length]);

  const goToNext = useCallback(() => {
    setActiveIndex((i) => (i + 1) % sortedImages.length);
  }, [sortedImages.length]);

  // Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;

    const deltaX = touchStartX.current - touchEndX.current;
    const SWIPE_THRESHOLD = 50;

    if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) {
        // Swiped left → next image
        goToNext();
      } else {
        // Swiped right → previous image
        goToPrev();
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  // Desktop click opens lightbox
  const handleMainImageClick = () => {
    if (currentImage) {
      setShowLightbox(true);
    }
  };

  if (sortedImages.length === 0) {
    return (
      <div className="aspect-square rounded-2xl bg-muted border border-border flex items-center justify-center">
        <span className="text-muted-foreground text-sm">No image</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Main image area */}
      <div
        className="relative aspect-square rounded-2xl overflow-hidden bg-muted border border-border cursor-zoom-in group"
        onTouchStart={hasMultipleImages ? handleTouchStart : undefined}
        onTouchMove={hasMultipleImages ? handleTouchMove : undefined}
        onTouchEnd={hasMultipleImages ? handleTouchEnd : undefined}
      >
        <ProxiedImage
          src={currentImage!.url}
          preset="gallery"
          alt={currentImage!.alt_text ?? ""}
          className="object-contain w-full h-full transition-transform duration-300 group-hover:scale-105"
          loading="eager"
          onClick={handleMainImageClick}
        />

        {/* Zoom icon overlay on hover (desktop) */}
        <div className="absolute top-3 right-3 w-9 h-9 bg-black/30 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition pointer-events-none">
          <ZoomIn size={16} />
        </div>

        {/* Navigation arrows for multi-image (visible on hover, desktop) */}
        {hasMultipleImages && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToPrev();
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 hover:bg-white rounded-full flex items-center justify-center text-foreground shadow-sm opacity-0 group-hover:opacity-100 transition"
              aria-label="Previous image"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 hover:bg-white rounded-full flex items-center justify-center text-foreground shadow-sm opacity-0 group-hover:opacity-100 transition"
              aria-label="Next image"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip (only for multi-image products) */}
      {hasMultipleImages && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sortedImages.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border-2 transition",
                activeIndex === i
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border hover:border-primary/50"
              )}
              aria-label={`View image ${i + 1}`}
            >
              <ProxiedImage
                src={img.url}
                preset="thumbnail"
                alt={img.alt_text ?? ""}
                className="object-cover w-full h-full"
                loading={i === 0 ? "eager" : "lazy"}
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {showLightbox && (
        <Lightbox
          images={sortedImages}
          initialIndex={activeIndex}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </div>
  );
}
