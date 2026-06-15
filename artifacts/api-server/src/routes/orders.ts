import { Router } from "express";
import type { Tables } from "@workspace/supabase-types";
import { getAdminSupabase } from "../lib/supabase";
import { requireUser } from "../middlewares/requireUser";
import { platformStatus } from "../middlewares/platformStatus";
import { queueNotification } from "../lib/notifications";
import { calculateDiscount } from "../lib/coupon-calc";
import { decrementStockSafe } from "../lib/rpc";

const router = Router();

interface OrderItemInput {
  product_id: string;
  quantity: number;
}

router.post("/orders", platformStatus("order_submit"), requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const { items, customer_name, customer_phone, delivery_address, notes, coupon_code } = req.body;

  if (!items?.length || !customer_name || !customer_phone || !delivery_address) {
    return res.status(400).json({ error: "Missing required order fields" });
  }

  const admin = getAdminSupabase();
  const productIds = (items as OrderItemInput[]).map((i) => i.product_id);

  const { data: products } = await admin
    .from("products")
    .select("id, price, stock, product_translations(lang_code, title)")
    .in("id", productIds);

  if (!products) return res.status(500).json({ error: "Failed to fetch products" });

  const productMap = new Map(products.map((p) => [p.id, p]));
  let subtotal = 0;
  const orderItems = [];

  for (const item of items as OrderItemInput[]) {
    const product = productMap.get(item.product_id);
    if (!product) return res.status(400).json({ error: `Product not found: ${item.product_id}` });
    if (product.stock < item.quantity) {
      return res.status(400).json({ error: `Insufficient stock`, product_id: item.product_id });
    }
    const title = product.product_translations.find((t) => t.lang_code === "az")?.title
      ?? product.product_translations[0]?.title ?? "Product";
    const lineTotal = Number(product.price) * item.quantity;
    subtotal += lineTotal;
    orderItems.push({
      product_id: item.product_id,
      quantity: item.quantity,
      product_price_snapshot: product.price,
      product_title_snapshot: title,
      line_total: lineTotal,
    });
  }

  let discountAmount = 0;
  let couponId: string | null = null;
  let couponData: Tables<"coupons"> | null = null;

  if (coupon_code) {
    const { data: coupon } = await admin
      .from("coupons")
      .select("*")
      .eq("code", coupon_code.trim().toUpperCase())
      .eq("is_active", true)
      .maybeSingle();

    if (coupon) {
      const now = new Date();
      const notExpired = !coupon.expires_at || new Date(coupon.expires_at) > now;
      const withinMaxUses = !coupon.max_uses || coupon.used_count < coupon.max_uses;

      if (notExpired && withinMaxUses) {
        const result = calculateDiscount(
          {
            discount_type: coupon.discount_type as "percentage" | "fixed",
            discount_value: coupon.discount_value,
            min_order_amount: coupon.min_order_amount,
          },
          subtotal,
        );
        if (result.ok) {
          discountAmount = result.discount_amount;
          couponId = coupon.id;
          couponData = coupon;
        }
      }
    }
  }

  const totalAzn = subtotal - discountAmount;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      user_id: user.id,
      status: "pending",
      customer_name,
      customer_phone,
      delivery_address,
      notes: notes ?? null,
      discount_azn: discountAmount,
      total_azn: totalAzn,
      coupon_id: couponId,
    })
    .select("id")
    .single();

  if (orderError) throw orderError;

  await admin.from("order_items").insert(
    orderItems.map((item) => ({ ...item, order_id: order.id }))
  );

  // Atomic stock deduction — use RPC if available, else conditional update
  for (const item of items as OrderItemInput[]) {
    const product = productMap.get(item.product_id)!;
    const { error: stockErr } = await decrementStockSafe(admin, item.product_id, item.quantity);
    if (stockErr) {
      // Fallback: conditional update (protects against race condition via WHERE stock >= qty)
      const { data: updated } = await admin
        .from("products")
        .update({ stock: product.stock - item.quantity })
        .eq("id", item.product_id)
        .gte("stock", item.quantity)
        .select("id");
      if (!updated || updated.length === 0) {
        // Race condition: stock depleted between check and update
        // Rollback by deleting the order (best-effort)
        await admin.from("orders").delete().eq("id", order.id);
        return res.status(409).json({ error: `Out of stock: ${item.product_id}` });
      }
    }
  }

  // Record coupon usage
  if (couponId && couponData) {
    await admin.from("coupons").update({ used_count: (couponData.used_count ?? 0) + 1 }).eq("id", couponId);
    await admin.from("coupon_usages").insert({
      coupon_id: couponId,
      user_id: user.id,
      order_id: order.id,
    });
  }

  // Queue WhatsApp notification (fire-and-forget; never blocks order response)
  queueNotification({
    userId: user.id,
    type: "order_confirmed",
    recipient: customer_phone,
    payload: {
      order_id: order.id,
      total: totalAzn,
      item_count: orderItems.length,
      status: "confirmed",
    },
  }).catch(() => {});

  return res.status(201).json({ success: true, orderId: order.id });
});

router.get("/profile/orders", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const admin = getAdminSupabase();
  const { data: orders, error } = await admin
    .from("orders")
    .select("*, order_items(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return res.json(orders ?? []);
});

router.get("/orders/:id", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const admin = getAdminSupabase();
  const orderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { data: order } = await admin
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", orderId)
    .single();

  if (!order) return res.status(404).json({ error: "Not found" });

  if (order.user_id !== user.id) {
    const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  }

  return res.json(order);
});

export default router;
