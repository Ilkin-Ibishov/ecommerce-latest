import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";

const router = Router();

// GET /api/categories/:slug/products
// Returns products for a category using product_specs (workaround for missing product_categories table)
router.get("/categories/:slug/products", async (req, res) => {
  try {
    const admin = getAdminSupabase();
    const { slug } = req.params;
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const pageSize = Math.min(100, parseInt((req.query.limit as string) ?? "24", 10));
    const sort = (req.query.sort as string) ?? "sort_order";

    // 1. Get category id from slug
    const { data: cat } = await (admin as any)
      .from("categories")
      .select("id, slug, icon_url, category_translations(*)")
      .eq("slug", slug)
      .single();

    if (!cat) return res.status(404).json({ error: "Category not found" });

    // 2. Get all product ids linked to this category
    const { data: specs } = await (admin as any)
      .from("product_specs")
      .select("product_id")
      .eq("spec_key", "__category")
      .eq("spec_value", cat.id);

    const allIds: string[] = (specs ?? []).map((s: any) => s.product_id);
    const total = allIds.length;

    if (total === 0) {
      return res.json({ category: cat, products: [], total, page, pageSize });
    }

    // 3. Fetch products with sorting
    let query = (admin as any)
      .from("products")
      .select("id, slug, price, original_price, stock, is_on_sale, is_deal_of_day, brand, sort_order, created_at, product_images(*), product_translations(*)")
      .in("id", allIds);

    if (sort === "price_asc") query = query.order("price", { ascending: true });
    else if (sort === "price_desc") query = query.order("price", { ascending: false });
    else if (sort === "newest") query = query.order("created_at", { ascending: false });
    else query = query.order("sort_order", { ascending: true });

    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data: products } = await query;

    return res.json({ category: cat, products: products ?? [], total, page, pageSize });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/categories — list all categories with translations
router.get("/categories", async (req, res) => {
  try {
    const admin = getAdminSupabase();
    const { data } = await (admin as any)
      .from("categories")
      .select("id, slug, icon_url, parent_id, category_translations(*)")
      .order("slug");
    return res.json(data ?? []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
