import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { getTranslatedField } from "@/lib/utils";

const STORAGE_KEY = "ilk_recently_viewed";
const MAX_ITEMS = 8;

export function trackView(productId: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const filtered = ids.filter((id) => id !== productId);
    const updated = [productId, ...filtered].slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

export function getRecentlyViewedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export default function RecentlyViewed({ locale, excludeId }: { locale: string; excludeId?: string }) {
  const [products, setProducts] = useState<any[]>([]);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const ids = getRecentlyViewedIds().filter((id) => id !== excludeId);
    if (ids.length === 0) return;
    const supabase = createClient();
    supabase
      .from("products")
      .select("id, slug, price, stock, is_on_sale, product_images(*), product_translations(*)")
      .in("id", ids.slice(0, 8))
      .then(({ data }: any) => {
        if (!data) return;
        const ordered = ids.map((id) => data.find((p: any) => p.id === id)).filter(Boolean);
        setProducts(ordered);
      });
  }, [excludeId]);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const hasOverflow = scrollWidth > clientWidth;
    setCanScrollLeft(hasOverflow && scrollLeft > 0);
    setCanScrollRight(hasOverflow && scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateArrows();

    el.addEventListener("scroll", updateArrows, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      updateArrows();
    });
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("scroll", updateArrows);
      resizeObserver.disconnect();
    };
  }, [products, updateArrows]);

  const scrollByPage = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollAmount = direction === "left" ? -el.clientWidth : el.clientWidth;
    el.scrollBy({ left: scrollAmount, behavior: "smooth" });
  };

  if (products.length === 0) return null;

  const getTitle = (p: any) =>
    getTranslatedField(p.product_translations, locale, "title", "");

  return (
    <section className="border-t border-border pt-10 mt-10">
      <h2 className="text-xl font-bold mb-5">{t("RecentlyViewed.title")}</h2>
      <div className="relative group">
        {/* Left Arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scrollByPage("left")}
            aria-label={t("RecentlyViewed.previous")}
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-background border border-border shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-accent"
          >
            <ChevronLeft size={18} />
          </button>
        )}

        {/* Scroll Container */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-2"
          style={{
            scrollSnapType: "x mandatory",
            scrollBehavior: "smooth",
          }}
        >
          {products.map((p: any) => (
            <Link
              key={p.id}
              href={`/${locale}/products/${p.slug}`}
              className="shrink-0 w-36 rounded-xl border border-border overflow-hidden hover:shadow-md transition group/card"
              style={{ scrollSnapAlign: "start" }}
            >
              <div className="aspect-square bg-muted overflow-hidden">
                {p.product_images?.[0]?.url ? (
                  <img
                    src={p.product_images[0].url}
                    alt={getTitle(p)}
                    className="object-cover w-full h-full group-hover/card:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                    No image
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="text-xs line-clamp-2 group-hover/card:text-primary transition leading-snug">
                  {getTitle(p)}
                </p>
                <p className="text-xs font-bold text-primary mt-1">{Number(p.price).toFixed(2)} AZN</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Right Arrow */}
        {canScrollRight && (
          <button
            onClick={() => scrollByPage("right")}
            aria-label={t("RecentlyViewed.next")}
            className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-background border border-border shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-accent"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </section>
  );
}
