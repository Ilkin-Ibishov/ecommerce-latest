import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";

const router = Router();

router.get("/products/:id/related", async (req, res) => {
  try {
    const admin = getAdminSupabase();
    const { id } = req.params;

    const { data: cats } = await (admin as any)
      .from("product_categories")
      .select("category_id")
      .eq("product_id", id);

    if (!cats || cats.length === 0) {
      return res.json([]);
    }

    const categoryIds = cats.map((c: any) => c.category_id);

    const { data: productLinks } = await (admin as any)
      .from("product_categories")
      .select("product_id")
      .in("category_id", categoryIds)
      .neq("product_id", id)
      .limit(20);

    if (!productLinks || productLinks.length === 0) {
      return res.json([]);
    }

    const productIds = [...new Set((productLinks as any[]).map((p: any) => p.product_id))].slice(0, 8);

    const { data: products } = await (admin as any)
      .from("products")
      .select("id, slug, price, original_price, stock, is_on_sale, is_deal_of_day, brand, product_images(*), product_translations(*)")
      .in("id", productIds)
      .order("sort_order")
      .limit(8);

    return res.json(products ?? []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/products/:id/specs", async (req, res) => {
  try {
    const admin = getAdminSupabase();
    const { data } = await (admin as any)
      .from("product_specs")
      .select("id, spec_key, spec_value, sort_order")
      .eq("product_id", req.params.id)
      .order("sort_order");
    return res.json(data ?? []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
