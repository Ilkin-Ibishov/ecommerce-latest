import { createAdminClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import CategoryManager from "@/components/admin/category-manager";

export const metadata: Metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  const admin = await createAdminClient();
  const { data: rawCategories } = await (admin as any)
    .from("categories")
    .select("*, category_translations(*)")
    .is("parent_id", null)
    .order("id");

  const categories = (rawCategories ?? []) as any[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Categories</h1>
      <CategoryManager initialCategories={categories} />
    </div>
  );
}
