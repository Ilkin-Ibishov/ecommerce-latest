import { Router } from "express";
import type { Tables } from "@workspace/supabase-types";
import { getAdminSupabase } from "../lib/supabase";
import { requireUser } from "../middlewares/requireUser";
import { validate } from "../middlewares/validate";
import { platformStatus } from "../middlewares/platformStatus";
import { queueNotification } from "../lib/notifications";
import { calculateDiscount } from "../lib/coupon-calc";
import { decrementStockSafe, incrementStock } from "../lib/rpc";
import { orderRateLimit } from "../middlewares/rateLimits";
import { OrderBodySchema } from "./admin/schemas";

const router = Router();

interface OrderItemInput {
  product_id: string;
  quantity: number;
}

router.post("/orders", platformStatus("order_submit"), requireUser, orderRateLimit, validate(OrderBodySchema), async (req, res) => {
  const user = { id: req.authUser!.id };

  const { items, customer_name, customer_phone, delivery_address, notes, coupon_code } = req.body;

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

  // SEC-005: Decrement stock BEFORE order insert to eliminate TOCTOU race
  const decremented: { productId: string; qty: number }[] = [];

  for (const item of items as OrderItemInput[]) {
    const { error } = await decrementStockSafe(admin, item.product_id, item.quantity);
    if (error) {
      // Roll back all previous decrements (best-effort)
      for (const d of decremented) {
        await incrementStock(admin, d.productId, d.qty).catch((e) =>
          req.log.error({ error: e, productId: d.productId }, "Stock rollback failed")
        );
      }
      res.status(409).json({ error: "Out of stock", product_id: item.product_id });
      return;
    }
    decremented.push({ productId: item.product_id, qty: item.quantity });
  }

  // All stock decrements succeeded — insert order + order_items
  let order: { id: string };
  try {
    const { data: orderData, error: orderError } = await admin
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
    order = orderData;

    await admin.from("order_items").insert(
      orderItems.map((item) => ({ ...item, order_id: order.id }))
    );
  } catch (err) {
    // Order insert failed — roll back ALL stock decrements
    for (const d of decremented) {
      await incrementStock(admin, d.productId, d.qty).catch((e) =>
        req.log.error({ error: e, productId: d.productId }, "Stock rollback failed after order insert error")
      );
    }
    throw err; // Let errorHandler return 500
  }

  // SEC-006: Coupon usage — per-user check BEFORE global increment (no side effects on rejection)
  if (couponId && couponData) {
    // Step 1: Check per-user limit BEFORE any mutations
    if (couponData.max_uses_per_user) {
      const { count } = await admin
        .from("coupon_usages")
        .select("*", { count: "exact", head: true })
        .eq("coupon_id", couponData.id)
        .eq("user_id", user.id);

      if ((count ?? 0) >= couponData.max_uses_per_user) {
        // Roll back order + stock (no coupon side effects occurred)
        await admin.from("order_items").delete().eq("order_id", order.id);
        await admin.from("orders").delete().eq("id", order.id);
        for (const d of decremented) {
          await incrementStock(admin, d.productId, d.qty).catch((e) =>
            req.log.error({ error: e, productId: d.productId }, "Stock rollback failed after per-user coupon limit")
          );
        }
        res.status(400).json({ error: "Coupon usage limit reached for your account" });
        return;
      }
    }

    // Step 2: Increment global used_count with conditional guard (atomic)
    const { data: updated } = await admin
      .from("coupons")
      .update({ used_count: (couponData.used_count ?? 0) + 1 })
      .eq("id", couponId)
      .lt("used_count", couponData.max_uses ?? 999999)
      .select("id");

    if (!updated || updated.length === 0) {
      // Race condition: global coupon limit exceeded — roll back order + stock
      await admin.from("order_items").delete().eq("order_id", order.id);
      await admin.from("orders").delete().eq("id", order.id);
      for (const d of decremented) {
        await incrementStock(admin, d.productId, d.qty).catch((e) =>
          req.log.error({ error: e, productId: d.productId }, "Stock rollback failed after coupon limit race")
        );
      }
      res.status(400).json({ error: "Coupon usage limit exceeded" });
      return;
    }

    // Step 3: Record per-user usage
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
