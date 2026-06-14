import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";
import { requireUser } from "../middlewares/requireUser";
import { mergeGuestCart, type CartEntry } from "../lib/cart-merge";

const router = Router();

function toCartEntry(item: { product_id: string; quantity: number }): CartEntry {
  return { product_id: item.product_id, quantity: item.quantity };
}

router.post("/cart/merge", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  const admin = getAdminSupabase();

  const { data: guestItems } = await admin
    .from("cart_items")
    .select("*")
    .eq("session_id", session_id)
    .is("user_id", null);

  if (!guestItems?.length) return res.json({ merged: 0 });

  const { data: userItems } = await admin
    .from("cart_items")
    .select("product_id, quantity, id")
    .eq("user_id", user.id);

  const userMap = new Map((userItems ?? []).map((i) => [i.product_id, i]));

  const merged = mergeGuestCart(
    (userItems ?? []).map((i) => toCartEntry(i)),
    guestItems.map((i) => toCartEntry(i)),
  );
  const mergedQuantityByProduct = new Map<string, number>(
    merged.mergedCart.map((entry) => [entry.product_id, entry.quantity]),
  );
  const guestProductIds = new Set<string>(
    guestItems.map((i) => i.product_id),
  );

  for (const product_id of guestProductIds) {
    const quantity = mergedQuantityByProduct.get(product_id)!;
    const existing = userMap.get(product_id);
    if (existing) {
      await admin
        .from("cart_items")
        .update({ quantity })
        .eq("id", existing.id);
    } else {
      // TODO(types): cart_items.Insert requires session_id in the generated schema,
      // but user-cart rows are inserted without it; cast retained to preserve runtime
      // behavior until the schema/types are reconciled.
      await (admin as any)
        .from("cart_items")
        .insert({ user_id: user.id, product_id, quantity });
    }
  }

  await admin
    .from("cart_items")
    .delete()
    .eq("session_id", session_id)
    .is("user_id", null);

  return res.json({ merged: guestItems.length });
});

router.get("/cart", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const admin = getAdminSupabase();
  const { data } = await admin
    .from("cart_items")
    .select("id, quantity, products(id, slug, price, product_images(*), product_translations(*))")
    .eq("user_id", user.id);

  return res.json(data ?? []);
});

export default router;
