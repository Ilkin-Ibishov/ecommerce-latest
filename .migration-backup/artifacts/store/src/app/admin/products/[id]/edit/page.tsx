import { createAdminClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import ProductForm from "@/components/admin/product-form";

export const metadata: Metadata = { title: "Edit Product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await createAdminClient();

  const [{ data: rawProduct }, { data: rawCategories }] = await Promise.all([
    (admin as any)
      .from("products")
      .select("*, product_translations(*), product_images(*), product_categories(category_id)")
      .eq("id", id)
      .single(),
    (admin as any)
      .from("categories")
      .select("id, slug, category_translations(lang_code, title)")
      .order("id"),
  ]);

  if (!rawProduct) notFound();
  const product = rawProduct as any;
  const categories = (rawCategories ?? []) as any[];

  const images = (product.product_images as any[])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((img: any) => ({ url: img.url, alt_text: img.alt_text ?? "" }));

  const initial = {
    slug: product.slug,
    price: product.price,
    stock: product.stock,
    sort_order: product.sort_order ?? 0,
    is_featured: product.is_featured,
    is_on_sale: product.is_on_sale,
    is_deal_of_day: product.is_deal_of_day,
    translations: (product.product_translations as any[]).map((t: any) => ({
      lang_code: t.lang_code,
      title: t.title,
      description: t.description ?? "",
    })),
    images,
    category_ids: (product.product_categories as any[]).map((pc: any) => pc.category_id),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/products" className="text-muted-foreground hover:text-foreground text-sm transition">
          ← Products
        </Link>
        <h1 className="text-2xl font-bold">Edit Product</h1>
      </div>
      <ProductForm productId={id} initial={initial} categories={categories} />
    </div>
  );
}
