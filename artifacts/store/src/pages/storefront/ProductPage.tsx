import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ProductDetail from "@/components/storefront/ProductDetail";

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

      const { data: commentsData } = await supabase
        .from("comments")
        .select("id, content, created_at, users(full_name)")
        .eq("product_id", data.id)
        .eq("approved", true)
        .order("created_at", { ascending: false })
        .limit(10);

      setProduct({ ...data, _sortedImages: sortedImages, _translation: translation, _comments: commentsData ?? [] });
      setLoading(false);
    }
    load();
  }, [slug, locale]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Loading...</div>;
  if (notFound) return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-4">Product not found</h1>
      <a href={`/${locale}/products`} className="text-primary hover:underline">Back to products</a>
    </div>
  );

  return (
    <ProductDetail
      product={product}
      images={product._sortedImages}
      translation={product._translation}
      comments={product._comments}
      locale={locale}
    />
  );
}
