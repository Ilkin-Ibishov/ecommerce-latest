import { createAdminClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import Link from "next/link";
import ProductForm from "@/components/admin/product-form";

export const metadata: Metadata = { title: "New Product" };

export default async function NewProductPage() {
  const admin = await createAdminClient();
  const { data: categories = [] } = await admin
    .from("categories")
    .select("id, slug, category_translations(lang_code, title)")
    .order("id");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/products" className="text-muted-foreground hover:text-foreground text-sm transition">
          ← Products
        </Link>
        <h1 className="text-2xl font-bold">New Product</h1>
      </div>
      <ProductForm categories={categories as any} />
    </div>
  );
}
