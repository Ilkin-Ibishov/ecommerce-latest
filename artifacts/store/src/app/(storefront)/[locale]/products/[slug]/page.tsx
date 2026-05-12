import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ProductDetail from "@/components/storefront/product-detail";

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("product_translations(lang_code,title)")
    .eq("slug", slug)
    .single();
  const title =
    ((data as any)?.product_translations as any[])?.find((t: any) => t.lang_code === locale)?.title ??
    ((data as any)?.product_translations as any[])?.[0]?.title ??
    "Product";
  return { title };
}

export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  const supabase = await createClient();

  const { data: rawProduct } = await supabase
    .from("products")
    .select(`*, product_images(id, url, alt_text, sort_order), product_translations(id, lang_code, title, description)`)
    .eq("slug", slug)
    .single();

  if (!rawProduct) notFound();
  const product = rawProduct as any;

  const images = (product.product_images as any[]).sort(
    (a: any, b: any) => a.sort_order - b.sort_order
  );

  const translation =
    (product.product_translations as any[]).find((t: any) => t.lang_code === locale) ??
    (product.product_translations as any[])[0] ??
    { title: "Product", description: null };

  const { data: rawComments } = await supabase
    .from("comments")
    .select("id, content, created_at, users(full_name)")
    .eq("product_id", product.id)
    .eq("approved", true)
    .order("created_at", { ascending: false })
    .limit(10);

  const comments = (rawComments ?? []) as any[];

  return (
    <ProductDetail
      product={product}
      images={images}
      translation={translation}
      comments={comments}
      locale={locale}
    />
  );
}
