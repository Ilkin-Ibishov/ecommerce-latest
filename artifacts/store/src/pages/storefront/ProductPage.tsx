import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import ProductDetail from "@/components/storefront/ProductDetail";
import { trackView } from "@/components/storefront/RecentlyViewed";
import { useI18n } from "@/lib/i18n/context";
import { getTranslatedField } from "@/lib/utils";
import { StorefrontBreadcrumb, resolveBreadcrumbPath, type BreadcrumbSegment } from "@/components/storefront/StorefrontBreadcrumb";
import { getCategoriesTree } from "@/lib/queries/categories";
import { Shimmer } from "@/components/ui/shimmer";

export default function ProductPage({ locale, slug }: { locale: string; slug: string }) {
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [breadcrumbSegments, setBreadcrumbSegments] = useState<BreadcrumbSegment[]>([]);
  const { t } = useI18n();

  useEffect(() => {
    const supabase = createClient();
    // Reset state when slug changes to show loading and prevent stale data
    setLoading(true);
    setProduct(null);
    setNotFound(false);
    setBreadcrumbSegments([]);

    async function load() {
      const { data } = await supabase
        .from("products")
        .select("*, product_images(id, url, alt_text, sort_order), product_translations(id, lang_code, title, description), product_categories(category_id)")
        .eq("slug", slug)
        .single();
      if (!data) { setNotFound(true); setLoading(false); return; }

      const sortedImages = [...(data.product_images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
      const picked = (data.product_translations as any[]).find((t: any) => t.lang_code === locale)
        ?? (data.product_translations as any[])[0];
      const translation = {
        title: getTranslatedField(data.product_translations as any[], locale, "title", "Product"),
        description: picked?.description ?? null,
      };

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

      // Resolve breadcrumb from category tree
      const categoryId = (data.product_categories as any[])?.[0]?.category_id;
      if (categoryId) {
        try {
          const tree = await getCategoriesTree(supabase);
          const path = resolveBreadcrumbPath(tree, categoryId, locale);
          // Prefix segment hrefs with locale
          const localizedPath = path.map((seg) => ({
            ...seg,
            href: `/${locale}${seg.href}`,
          }));
          setBreadcrumbSegments(localizedPath);
        } catch {
          // Graceful degradation: breadcrumb will show Home > Product Title only
        }
      }
    }
    load();
  }, [slug, locale]);

  if (loading) return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb placeholder */}
      <Shimmer className="h-4 w-48 rounded mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        {/* Gallery area */}
        <Shimmer className="aspect-square rounded-2xl" />
        {/* Product info area */}
        <div className="space-y-4">
          {/* Title */}
          <Shimmer className="h-8 w-3/4 rounded" />
          {/* Price */}
          <Shimmer className="h-10 w-40 rounded" />
          {/* Description */}
          <div className="space-y-2">
            <Shimmer className="h-4 w-full rounded" />
            <Shimmer className="h-4 w-5/6 rounded" />
            <Shimmer className="h-4 w-2/3 rounded" />
          </div>
          {/* Variants / size selection */}
          <div className="flex gap-2 pt-2">
            <Shimmer className="h-10 w-16 rounded-lg" />
            <Shimmer className="h-10 w-16 rounded-lg" />
            <Shimmer className="h-10 w-16 rounded-lg" />
            <Shimmer className="h-10 w-16 rounded-lg" />
          </div>
          {/* CTA button */}
          <Shimmer className="h-12 w-full rounded-full mt-4" />
          {/* Additional details block */}
          <Shimmer className="h-24 w-full rounded-xl" />
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
    <div className="container mx-auto px-4 pt-4">
      <StorefrontBreadcrumb
        segments={breadcrumbSegments}
        currentLabel={product._translation.title}
      />
      <ProductDetail
        product={product}
        images={product._sortedImages}
        translation={product._translation}
        comments={product._comments}
        specs={product._specs}
        related={product._related}
        locale={locale}
      />
    </div>
  );
}
