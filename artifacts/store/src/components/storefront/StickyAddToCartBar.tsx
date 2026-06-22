import { useState, useEffect, useCallback } from "react";
import { useCart } from "@/lib/cart/context";
import { useI18n } from "@/lib/i18n/context";
import { toastCartAdd } from "@/hooks/use-toast";
import { AnimatedCartButton } from "./AnimatedCartButton";

interface StickyAddToCartBarProps {
  product: {
    product_id: string;
    slug: string;
    title: string;
    price: number;
    image: string | null;
    stock: number;
  };
  primaryCtaRef: React.RefObject<HTMLElement | null>;
}

/**
 * StickyAddToCartBar — fixed bottom bar that appears when the primary CTA
 * scrolls out of view on viewports below 1024px.
 *
 * Positioning:
 * - Below md (< 768px): bottom offset accounts for MobileBottomNav (h-16 = 4rem) + safe area
 * - md+ (≥ 768px): MobileBottomNav is hidden (md:hidden), so bar sits at bottom: 0
 * - lg+ (≥ 1024px): bar is hidden entirely (lg:hidden)
 *
 * z-index: 45 — above page content (z-40), below MobileBottomNav (z-50) and modals (z-50+)
 */
export function StickyAddToCartBar({ product, primaryCtaRef }: StickyAddToCartBarProps) {
  const [visible, setVisible] = useState(false);
  const { addItem } = useCart();
  const { t } = useI18n();

  useEffect(() => {
    const target = primaryCtaRef.current;
    if (!target) return;

    // Only observe on viewports < 1024px
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    if (mediaQuery.matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show bar when primary CTA is NOT intersecting (scrolled out of view)
        setVisible(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(target);

    // Cleanup on media change (if user resizes past lg breakpoint)
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setVisible(false);
        observer.disconnect();
      } else {
        observer.observe(target);
      }
    };

    mediaQuery.addEventListener("change", handleMediaChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", handleMediaChange);
    };
  }, [primaryCtaRef]);

  const handleAdd = useCallback(() => {
    addItem(
      {
        product_id: product.product_id,
        slug: product.slug,
        title: product.title,
        price: product.price,
        image: product.image,
      },
      1
    );
    toastCartAdd(t, product.title);
  }, [addItem, product, t]);

  const outOfStock = product.stock === 0;

  return (
    <div
      className={[
        "fixed left-0 right-0 z-[45] lg:hidden",
        "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-0",
        "bg-background border-t border-border",
        "transition-transform duration-200 ease-in-out",
        visible ? "translate-y-0" : "translate-y-full",
      ].join(" ")}
      aria-hidden={!visible}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        {/* Product info: title + price */}
        <div className="flex flex-col min-w-0 max-w-[50%]">
          <span className="text-sm font-medium truncate">{product.title}</span>
          <span className="text-sm font-bold text-primary">
            {Number(product.price).toFixed(2)} AZN
          </span>
        </div>

        {/* Add to cart action */}
        {outOfStock ? (
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center h-9 px-4 text-sm font-medium rounded-md bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
          >
            {t("StickyBar.outOfStock")}
          </button>
        ) : (
          <AnimatedCartButton
            onAdd={handleAdd}
            label={t("StickyBar.addToCart")}
            size="sm"
          />
        )}
      </div>
    </div>
  );
}
