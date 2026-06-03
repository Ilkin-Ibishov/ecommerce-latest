import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import ProductDetail from "@/components/storefront/ProductDetail";
import { trackView } from "@/components/storefront/RecentlyViewed";

export default function ProductPage({ locale, slug }: { locale: string; slug: string }) {
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data } = await supabase
        .from("products")
        .select("*, product_images(id, url, alt_text, sort_order), product_translations(id, lang_code, title, description)")
        .eq("slug", slug)
        .single();
      if (!data) { setNotFound(true); setLoading(false); return; }

      const sortedImages = [...(data.product_images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
      const translation = (data.product_translations as any[]).find((t: any) => t.lang_code === locale)
        ?? (data.product_translations as any[])[0]
        ?? { title: "Product", description: null };

      const [commentsRes, specsRes, relatedRes] = await Promise.all([
        supabase
          .from("comments")
          .select("id, content, rating, created_at, users(full_name)")
          .eq("product_id", data.id)
          .eq("approved", true)
          .order("created_at", { ascending: false })
          .limit(10),
        fetch(apiUrl(`/products/${data.id}/specs`)).then((r) => r.ok ? r.json() : []).catch(() => []),
        fetch(apiUrl(`/products/${data.id}/related`)).then((r) => r.ok ? r.json() : []).catch(() => []),
      ]);

      setProduct({
        ...data,
        _sortedImages: sortedImages,
        _translation: translation,
        _comments: commentsRes.data ?? [],
        _specs: Array.isArray(specsRes) ? specsRes : [],
        _related: Array.isArray(relatedRes) ? relatedRes : [],
      });
      setLoading(false);

      trackView(data.id);
    }
    load();
  }, [slug, locale]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
      Yüklənir…
    </div>
  );
  if (notFound) return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-4">Məhsul tapılmadı</h1>
      <a href={`/${locale}/products`} className="text-primary hover:underline">Bütün məhsullara qayıt</a>
    </div>
  );

  return (
    <ProductDetail
      product={product}
      images={product._sortedImages}
      translation={product._translation}
      comments={product._comments}
      specs={product._specs}
      related={product._related}
      locale={locale}
    />
  );
}
