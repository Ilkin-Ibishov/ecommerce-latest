import { Router } from "express";
import { getSupabase, getAdminSupabase } from "../lib/supabase";

const router = Router();

router.get("/wishlist", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const admin = getAdminSupabase();
    const { data } = await (admin as any)
      .from("wishlists")
      .select("id, product_id, created_at, products(id, slug, price, product_images(*), product_translations(*))")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return res.json(data ?? []);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/wishlist", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ error: "product_id required" });

    const admin = getAdminSupabase();
    const { data, error } = await (admin as any)
      .from("wishlists")
      .upsert({ user_id: user.id, product_id }, { onConflict: "user_id,product_id", ignoreDuplicates: true })
      .select("id")
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ id: data?.id });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/wishlist/:productId", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const admin = getAdminSupabase();
    await (admin as any)
      .from("wishlists")
      .delete()
      .eq("user_id", user.id)
      .eq("product_id", req.params.productId);

    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
