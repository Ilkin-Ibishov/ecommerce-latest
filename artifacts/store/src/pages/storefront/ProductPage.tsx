import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import ProductDetail from "@/components/storefront/ProductDetail";
import { trackView } from "@/components/storefront/RecentlyViewed";
import { useI18n } from "@/lib/i18n/context";

export default function ProductPage({ locale, slug }: { locale: string; slug: string }) {
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const supabase = createClient();
    // Reset state when slug changes to show loading and prevent stale data
    setLoading(true);
    setProduct(null);
    setNotFound(false);

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
    <div className="container mx-auto px-4 py-8">
      <div className="h-4 w-48 bg-muted rounded animate-pulse mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="aspect-square rounded-2xl bg-muted animate-pulse" />
        <div className="space-y-4">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          <div className="h-8 w-3/4 bg-muted rounded animate-pulse" />
          <div className="h-10 w-40 bg-muted rounded animate-pulse" />
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          <div className="h-12 w-full bg-muted rounded-full animate-pulse mt-6" />
          <div className="h-24 w-full bg-muted rounded-xl animate-pulse" />
        </div>
      </div>
    </div>
  );
  if (notFound) return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-4">{t("ProductPage.notFound")}</h1>
      <a href={`/${locale}/products`} className="text-primary hover:underline">{t("ProductPage.notFoundBack")}</a>
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
