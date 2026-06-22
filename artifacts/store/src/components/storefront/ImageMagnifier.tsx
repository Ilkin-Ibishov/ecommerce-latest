import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";

// ─── Pure functions for property testing ─────────────────────────────────────

/**
 * Computes the pinch-to-zoom scale factor.
 *
 * Given the initial distance between two touch points and the current distance,
 * returns a scale value clamped between 1.0 (no zoom) and 4.0 (max zoom).
 *
 * @param initialDistance - distance between fingers at pinch start (pixels)
 * @param currentDistance - current distance between fingers (pixels)
 * @returns scale factor clamped to [1.0, 4.0]
 */
export function computePinchZoom(initialDistance: number, currentDistance: number): number {
  if (initialDistance <= 0) return 1.0;
  return Math.max(1.0, Math.min(4.0, currentDistance / initialDistance));
}

/**
 * Computes the lens position and background offset for the magnifier.
 *
 * The lens is clamped so the entire lens rectangle stays within the image bounds.
 * The background-position centers the zoomed region on the cursor coordinates.
 *
 * @param imageRect - dimensions of the displayed image { width, height }
 * @param cursorPos - cursor position relative to image top-left { x, y }
 * @param lensSize  - pixel size of the square lens
 * @param magnification - zoom factor (e.g. 2.5)
 * @returns lens top-left position and background-position for the zoomed view
 */
export function computeLensPosition(
  imageRect: { width: number; height: number },
  cursorPos: { x: number; y: number },
  lensSize: number,
  magnification: number
): { lensX: number; lensY: number; bgX: number; bgY: number } {
  const halfLens = lensSize / 2;

  // Center lens on cursor, then clamp within image bounds
  const rawX = cursorPos.x - halfLens;
  const rawY = cursorPos.y - halfLens;

  const lensX = Math.max(0, Math.min(rawX, imageRect.width - lensSize));
  const lensY = Math.max(0, Math.min(rawY, imageRect.height - lensSize));

  // Background-position: offset so the zoomed image is centered on cursor
  // The background is scaled by magnification, so we need to map cursor position
  // to background coordinates
  const bgX = -(cursorPos.x * magnification - halfLens);
  const bgY = -(cursorPos.y * magnification - halfLens);

  return { lensX, lensY, bgX, bgY };
}

// ─── Component types ─────────────────────────────────────────────────────────

export interface ImageMagnifierProps {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  magnification?: number; // default 2.5
  lensSize?: number; // default 150 (px)
  onImageClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * ImageMagnifier — Desktop hover-based image magnification + mobile pinch-to-zoom.
 *
 * Wraps the image element (passed as children) and renders a lens overlay
 * that tracks the cursor via requestAnimationFrame at 60fps.
 *
 * Features:
 * - Pure `computeLensPosition` function extracted for property testing
 * - Pure `computePinchZoom` function extracted for property testing
 * - Desktop only (≥768px): lens overlay on hover
 * - Mobile (<768px): pinch-to-zoom via touch events (1×–4× scale)
 * - Resolution check: won't activate if naturalWidth < displayWidth × magnification
 * - Lens clamped within image bounds
 * - 100ms fade-out on mouse leave
 * - 1px border + box-shadow for visual distinction
 * - pointer-events: none on lens (clicks pass through to image)
 * - will-change: transform for GPU acceleration
 * - Gesture conflict handling: sets isPinching flag + stopPropagation to prevent swipe nav
 * - touch-action: none during active pinch to prevent browser zoom
 */
export function ImageMagnifier({
  src,
  alt: _alt,
  naturalWidth,
  naturalHeight: _naturalHeight,
  magnification = 2.5,
  lensSize = 150,
  onImageClick,
  children,
  className,
}: ImageMagnifierProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const cursorRef = useRef({ x: 0, y: 0 });

  const [lensVisible, setLensVisible] = useState(false);
  const [lensStyle, setLensStyle] = useState<React.CSSProperties>({});
  const [isDesktop, setIsDesktop] = useState(false);
  const [canMagnify, setCanMagnify] = useState(false);

  // ─── Pinch-to-zoom state (mobile) ──────────────────────────────────────────
  const [pinchScale, setPinchScale] = useState(1.0);
  const [isPinching, setIsPinching] = useState(false);
  const initialPinchDistanceRef = useRef<number | null>(null);

  // Detect desktop viewport (≥768px)
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsDesktop(e.matches);
    };
    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Resolution check: naturalWidth must be >= displayWidth × magnification
  useEffect(() => {
    if (!containerRef.current || !isDesktop) {
      setCanMagnify(false);
      return;
    }

    const checkResolution = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const displayWidth = rect.width;
      setCanMagnify(naturalWidth >= displayWidth * magnification);
    };

    checkResolution();

    // Re-check on resize
    const ro = new ResizeObserver(checkResolution);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [naturalWidth, magnification, isDesktop]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const updateLens = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const imageRect = { width: rect.width, height: rect.height };
    const { lensX, lensY, bgX, bgY } = computeLensPosition(
      imageRect,
      cursorRef.current,
      lensSize,
      magnification
    );

    setLensStyle({
      left: `${lensX}px`,
      top: `${lensY}px`,
      width: `${lensSize}px`,
      height: `${lensSize}px`,
      backgroundImage: `url(${src})`,
      backgroundSize: `${imageRect.width * magnification}px ${imageRect.height * magnification}px`,
      backgroundPosition: `${bgX}px ${bgY}px`,
      backgroundRepeat: "no-repeat",
    });

    rafRef.current = null;
  }, [src, lensSize, magnification]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!canMagnify || !isDesktop) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      cursorRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      // Schedule update at 60fps via rAF
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(updateLens);
      }
    },
    [canMagnify, isDesktop, updateLens]
  );

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      if (!canMagnify || !isDesktop) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      cursorRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      setLensVisible(true);
      // Immediately compute initial lens position
      updateLens();
    },
    [canMagnify, isDesktop, updateLens]
  );

  const handleMouseLeave = useCallback(() => {
    setLensVisible(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    onImageClick?.();
  }, [onImageClick]);

  // ─── Pinch-to-zoom touch handlers (mobile <768px) ─────────────────────────

  /** Compute Euclidean distance between two touch points */
  const getTouchDistance = useCallback((touches: React.TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isDesktop) return;
      // Only initiate pinch with 2+ fingers
      if (e.touches.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        const dist = getTouchDistance(e.touches);
        initialPinchDistanceRef.current = dist;
        setIsPinching(true);
      }
    },
    [isDesktop, getTouchDistance]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isDesktop) return;
      if (!isPinching || e.touches.length < 2) return;

      e.preventDefault();
      e.stopPropagation();

      const currentDist = getTouchDistance(e.touches);
      const initialDist = initialPinchDistanceRef.current;
      if (initialDist && initialDist > 0) {
        const newScale = computePinchZoom(initialDist, currentDist);
        setPinchScale(newScale);
      }
    },
    [isDesktop, isPinching, getTouchDistance]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (isDesktop) return;
      // If pinching and fewer than 2 fingers remain, end pinch
      if (isPinching && e.touches.length < 2) {
        e.preventDefault();
        e.stopPropagation();
        setIsPinching(false);
        initialPinchDistanceRef.current = null;
        // Animate back to 1.0
        setPinchScale(1.0);
      }
    },
    [isDesktop, isPinching]
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        // Prevent browser-level zoom during active pinch
        touchAction: isPinching ? "none" : undefined,
      }}
    >
      {/* Pinch-to-zoom wrapper for mobile */}
      <div
        style={{
          transform: pinchScale !== 1.0 ? `scale(${pinchScale})` : undefined,
          transformOrigin: "center center",
          transition: isPinching ? "none" : "transform 200ms ease-out",
          willChange: isPinching ? "transform" : undefined,
        }}
      >
        {children}
      </div>

      {/* Magnifier lens overlay (desktop only) */}
      {isDesktop && canMagnify && (
        <div
          className={cn(
            "absolute pointer-events-none rounded-none",
            "border border-solid border-black/30",
            "shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
            "will-change-transform",
            "transition-opacity duration-100 ease-out",
            lensVisible ? "opacity-100" : "opacity-0"
          )}
          style={lensStyle}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
