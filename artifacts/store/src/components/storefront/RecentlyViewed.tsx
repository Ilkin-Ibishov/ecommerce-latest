import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";

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

  if (products.length === 0) return null;

  const getTitle = (p: any) =>
    p.product_translations?.find((tr: any) => tr.lang_code === locale)?.title
    ?? p.product_translations?.[0]?.title ?? "";

  return (
    <section className="border-t border-border pt-10 mt-10">
      <h2 className="text-xl font-bold mb-5">{t("RecentlyViewed.title")}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
        {products.map((p: any) => (
          <Link
            key={p.id}
            href={`/${locale}/products/${p.slug}`}
            className="snap-start shrink-0 w-36 rounded-xl border border-border overflow-hidden hover:shadow-md transition group"
          >
            <div className="aspect-square bg-muted overflow-hidden">
              {p.product_images?.[0]?.url ? (
                <img
                  src={p.product_images[0].url}
                  alt={getTitle(p)}
                  className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                  No image
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="text-xs line-clamp-2 group-hover:text-primary transition leading-snug">
                {getTitle(p)}
              </p>
              <p className="text-xs font-bold text-primary mt-1">{Number(p.price).toFixed(2)} AZN</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
