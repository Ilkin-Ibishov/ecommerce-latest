import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";
import { platformStatus } from "../middlewares/platformStatus";

const router = Router();

// POST /api/products/prices — bulk price check for cart items (storefront_read gated)
router.post("/products/prices", platformStatus("storefront_read"), async (req, res) => {
  const { product_ids } = req.body;
  if (!Array.isArray(product_ids) || product_ids.length === 0) {
    res.status(400).json({ error: "product_ids array is required" });
    return;
  }
  if (product_ids.length > 50) {
    res.status(400).json({ error: "Maximum 50 products per request" });
    return;
  }

  const admin = getAdminSupabase();
  const { data } = await admin
    .from("products")
    .select("id, price, stock, slug")
    .in("id", product_ids);

  const { data: availRows } = await (admin as any)
    .from("product_variant_public_availability")
    .select("product_id, available_quantity")
    .in("product_id", product_ids);

  const availMap = new Map<string, number>();
  for (const row of availRows ?? []) {
    availMap.set(row.product_id, (availMap.get(row.product_id) ?? 0) + Number(row.available_quantity));
  }

  const priceMap: Record<string, { price: number; stock: number; available: number; slug: string }> = {};
  for (const p of data ?? []) {
    const available = availMap.has(p.id) ? availMap.get(p.id)! : Number(p.stock);
    priceMap[p.id] = { price: Number(p.price), stock: available, available, slug: p.slug };
  }

  res.json(priceMap);
});

// GET /api/products/:id/related — uses product_specs (product_categories table doesn't exist)
router.get("/products/:id/related", platformStatus("storefront_read"), async (req, res) => {
  const admin = getAdminSupabase();
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Find categories for this product via product_specs
  const { data: catSpecs } = await admin
    .from("product_specs")
    .select("spec_value")
    .eq("product_id", id)
    .eq("spec_key", "__category");

  if (!catSpecs || catSpecs.length === 0) return res.json([]);

  const categoryIds = catSpecs.map((s) => s.spec_value);

  // Find sibling products in same categories
  const { data: siblingSpecs } = await admin
    .from("product_specs")
    .select("product_id")
    .in("spec_value", categoryIds)
    .eq("spec_key", "__category")
    .neq("product_id", id)
    .limit(20);

  if (!siblingSpecs || siblingSpecs.length === 0) return res.json([]);

  const productIds = [...new Set(siblingSpecs.map((p) => p.product_id))].slice(0, 8);

  const { data: products } = await admin
    .from("products")
    .select("id, slug, price, original_price, stock, is_on_sale, is_deal_of_day, brand, product_images(*), product_translations(*)")
    .in("id", productIds)
    .order("sort_order")
    .limit(8);

  if (products && products.length > 0) {
    const { data: availRows } = await (admin as any)
      .from("product_variant_public_availability")
      .select("product_id, available_quantity")
      .in("product_id", productIds);

    const availMap = new Map<string, number>();
    for (const row of availRows ?? []) {
      availMap.set(row.product_id, (availMap.get(row.product_id) ?? 0) + Number(row.available_quantity));
    }

    for (const p of products) {
      if (availMap.has(p.id)) {
        p.stock = availMap.get(p.id)!;
        (p as any).available_quantity = availMap.get(p.id)!;
      }
    }
  }

  return res.json(products ?? []);
});

// GET /api/products/:id/specs
router.get("/products/:id/specs", platformStatus("storefront_read"), async (req, res) => {
  const admin = getAdminSupabase();
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { data } = await admin
    .from("product_specs")
    .select("id, spec_key, spec_value, sort_order")
    .eq("product_id", id)
    .neq("spec_key", "__category")
    .order("sort_order");
  return res.json(data ?? []);
});

export default router;
