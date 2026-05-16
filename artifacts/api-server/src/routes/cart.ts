import { Router } from "express";
import { getSupabase, getAdminSupabase } from "../lib/supabase";

const router = Router();

router.post("/cart/merge", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: "session_id required" });

    const admin = getAdminSupabase();

    const { data: guestItems } = await (admin as any)
      .from("cart_items")
      .select("*")
      .eq("session_id", session_id)
      .is("user_id", null);

    if (!guestItems?.length) return res.json({ merged: 0 });

    const { data: userItems } = await (admin as any)
      .from("cart_items")
      .select("product_id, quantity, id")
      .eq("user_id", user.id);

    const userMap = new Map((userItems ?? []).map((i: any) => [i.product_id, i]));

    for (const guestItem of guestItems) {
      const existing = userMap.get(guestItem.product_id);
      if (existing) {
        await (admin as any)
          .from("cart_items")
          .update({ quantity: existing.quantity + guestItem.quantity })
          .eq("id", existing.id);
      } else {
        await (admin as any)
          .from("cart_items")
          .insert({ user_id: user.id, product_id: guestItem.product_id, quantity: guestItem.quantity });
      }
    }

    await (admin as any)
      .from("cart_items")
      .delete()
      .eq("session_id", session_id)
      .is("user_id", null);

    return res.json({ merged: guestItems.length });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cart", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const admin = getAdminSupabase();
    const { data } = await (admin as any)
      .from("cart_items")
      .select("id, quantity, products(id, slug, price, product_images(*), product_translations(*))")
      .eq("user_id", user.id);

    return res.json(data ?? []);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/profile/orders", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const admin = getAdminSupabase();
    const { data } = await (admin as any)
      .from("orders")
      .select("id, status, total_azn, discount_azn, customer_name, customer_phone, delivery_address, notes, created_at, order_items(id, product_title_snapshot, product_price_snapshot, quantity, line_total)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return res.json(data ?? []);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
