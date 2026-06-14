import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";
import { requireUser } from "../middlewares/requireUser";

const router = Router();

router.get("/wishlist", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const admin = getAdminSupabase();
  const { data } = await admin
    .from("wishlists")
    .select("id, product_id, created_at, products(id, slug, price, product_images(*), product_translations(*))")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return res.json(data ?? []);
});

router.post("/wishlist", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: "product_id required" });

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("wishlists")
    .upsert({ user_id: user.id, product_id }, { onConflict: "user_id,product_id", ignoreDuplicates: true })
    .select("id")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({ id: data?.id });
});

router.delete("/wishlist/:productId", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const admin = getAdminSupabase();
  const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  await admin
    .from("wishlists")
    .delete()
    .eq("user_id", user.id)
    .eq("product_id", productId);

  return res.json({ success: true });
});

export default router;
