import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";

export default function SearchPage({ locale }: { locale: string }) {
  const search = useSearch();
  const q = new URLSearchParams(search).get("q") ?? "";
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const supabase = createClient();

    // Try FTS RPC first (requires search_products function in DB), fallback to ilike
    (supabase as any).rpc("search_products", { query_text: q, lang_code: locale })
      .then(({ data, error }: any) => {
        if (error || !data) {
          // Fallback: basic ilike search with full product data including images
          return (supabase as any)
            .from("product_translations")
            .select("product_id, title, description, products(id, slug, price, product_images(*))")
            .eq("lang_code", locale)
            .ilike("title", `%${q}%`)
            .limit(50)
            .then(({ data: fallbackData }: any) => {
              const mapped = (fallbackData ?? []).map((pt: any) => ({
                id: pt.products?.id,
                slug: pt.products?.slug,
                price: pt.products?.price,
                title: pt.title,
                description: pt.description,
                image: pt.products?.product_images?.[0]?.url ?? null,
              }));
              setResults(mapped);
              setLoading(false);
            });
        }
        // FTS RPC returns { id, title, description, price, slug, rank }
        // Enrich with images from a second query
        const slugs = (data ?? []).map((r: any) => r.slug);
        if (!slugs.length) { setResults([]); setLoading(false); return; }
        return (supabase as any)
          .from("products")
          .select("id, slug, product_images(url, sort_order)")
          .in("slug", slugs)
          .then(({ data: imgData }: any) => {
            const imgMap = new Map((imgData ?? []).map((p: any) => [
              p.slug,
              p.product_images?.sort((a: any, b: any) => a.sort_order - b.sort_order)?.[0]?.url ?? null,
            ]));
            const enriched = (data ?? []).map((r: any) => ({
              ...r,
              image: imgMap.get(r.slug) ?? null,
            }));
            setResults(enriched);
            setLoading(false);
          });
      })
      .catch(() => { setResults([]); setLoading(false); });
  }, [q, locale]);

  if (!q.trim()) return (
    <div className="container mx-auto px-4 py-16 text-center">
      <p className="text-muted-foreground">{t("Search.enterSearchTerm")}</p>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">{t("Search.resultsFor")} &ldquo;{q}&rdquo;</h1>
      <p className="text-muted-foreground mb-8">{loading ? t("Search.searching") : t("Search.resultsCount").replace("{count}", String(results.length))}</p>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border overflow-hidden animate-pulse">
              <div className="aspect-square bg-muted" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-muted rounded" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">{t("Search.noResults")} &ldquo;{q}&rdquo;</p>
          <Link href={`/${locale}/products`} className="text-primary text-sm hover:underline mt-2 block">{t("Search.browseAll")}</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {results.map((product: any) => (
            <Link key={product.id ?? product.slug} href={`/${locale}/products/${product.slug}`}
              className="group rounded-xl border border-border overflow-hidden hover:shadow-md transition">
              <div className="aspect-square bg-muted overflow-hidden">
                {product.image ? (
                  <img src={product.image} alt={product.title} className="object-cover w-full h-full group-hover:scale-105 transition duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
                )}
              </div>
              <div className="p-3">
                <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition">{product.title}</h3>
                <p className="font-bold text-primary mt-1">{Number(product.price).toFixed(2)} AZN</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
