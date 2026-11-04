import { Router } from "express";
import type { Tables } from "@workspace/supabase-types";
import { getAdminSupabase } from "../lib/supabase";
import { requireUser } from "../middlewares/requireUser";
import { validate } from "../middlewares/validate";
import { platformStatus } from "../middlewares/platformStatus";
import { queueNotification } from "../lib/notifications";
import { calculateDiscount } from "../lib/coupon-calc";
import { decrementOrderStock, decrementStockSafe, incrementStock } from "../lib/rpc";
import { orderRateLimit } from "../middlewares/rateLimits";
import { OrderBodySchema } from "./admin/schemas";

const router = Router();

interface OrderItemInput {
  product_id: string;
  variant_id?: string;
  quantity: number;
}

router.post("/orders", platformStatus("order_submit"), requireUser, orderRateLimit, validate(OrderBodySchema), async (req, res) => {
  const user = { id: req.authUser!.id };

  const { items, customer_name, customer_phone, delivery_address, notes, coupon_code } = req.body;

  const admin = getAdminSupabase();
  const productIds = (items as OrderItemInput[]).map((i) => i.product_id);

  const { data: products } = await admin
    .from("products")
    .select("id, price, stock, product_translations(lang_code, title), product_variants(id, price, on_hand, sku, is_default)")
    .in("id", productIds);

  if (!products) return res.status(500).json({ error: "Failed to fetch products" });

  const productMap = new Map(products.map((p) => [p.id, p]));
  const allVariantIds = products.flatMap((p: any) => ((p.product_variants ?? []) as any[]).map((v) => v.id)).filter(Boolean);
  const { data: availRows } = allVariantIds.length > 0
    ? await (admin as any).from("product_variant_availability").select("variant_id, available_quantity").in("variant_id", allVariantIds)
    : { data: [] };
  const availMap = new Map<string, number>();
  for (const r of availRows ?? []) {
    availMap.set(r.variant_id, Number(r.available_quantity));
  }
  let subtotal = 0;
  const orderItems = [];

  for (const item of items as OrderItemInput[]) {
    const product = productMap.get(item.product_id);
    if (!product) return res.status(400).json({ error: `Product not found: ${item.product_id}` });

    const variants = ((product as any).product_variants ?? []) as any[];
    const variant = item.variant_id
      ? variants.find((v: any) => v.id === item.variant_id)
      : (variants.find((v: any) => v.is_default) ?? variants[0]);

    const availableStock = variant
      ? (availMap.has(variant.id) ? availMap.get(variant.id)! : Number(variant.on_hand))
      : (product.stock ?? 0);
    if (availableStock < item.quantity) {
      return res.status(400).json({ error: `Insufficient stock`, product_id: item.product_id });
    }

    const title = product.product_translations.find((t) => t.lang_code === "az")?.title
      ?? product.product_translations[0]?.title ?? "Product";
    const itemPrice = variant ? Number(variant.price) : Number(product.price);
    const lineTotal = itemPrice * item.quantity;
    subtotal += lineTotal;
    orderItems.push({
      product_id: item.product_id,
      variant_id: variant?.id ?? null,
      quantity: item.quantity,
      product_price_snapshot: itemPrice,
      product_title_snapshot: title,
      variant_title_snapshot: title,
      sku_snapshot: variant?.sku ?? null,
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

  // M2c C1: Atomically lock variants in ascending order and decrement stock in one DB call
  const orderId = crypto.randomUUID();
  const orderLines = orderItems.map((item) => ({
    variant_id: item.variant_id ?? item.product_id,
    quantity: item.quantity,
  }));

  const { error: stockError } = await decrementOrderStock(admin, orderId, orderLines, user.id);
  if (stockError) {
    const message = (stockError as any)?.message ?? "Out of stock";
    res.status(409).json({ error: "Out of stock", message });
    return;
  }

  // Stock decrement succeeded atomically — insert order + order_items
  let order: { id: string };
  try {
    const { data: orderData, error: orderError } = await admin
      .from("orders")
      .insert({
        id: orderId,
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
    // Order insert failed — roll back all stock decrements
    for (const item of orderItems) {
      const targetId = item.variant_id ?? item.product_id;
      await incrementStock(admin, targetId, item.quantity).catch((e) =>
        req.log.error({ error: e, targetId }, "Stock rollback failed after order insert error")
      );
    }
    throw err; // Let errorHandler return 500
  }

  // Insert initial status history record (non-blocking)
  try {
    await (admin as any)
      .from("order_status_history")
      .insert({
        order_id: order.id,
        old_status: null,
        new_status: "pending",
        changed_by: user.id,
      });
  } catch (err) {
    req.log.error({ error: err, orderId: order.id }, "Failed to insert initial status history");
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
        for (const item of orderItems) {
          const targetId = item.variant_id ?? item.product_id;
          await incrementStock(admin, targetId, item.quantity).catch((e) =>
            req.log.error({ error: e, targetId }, "Stock rollback failed after per-user coupon limit")
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
      for (const item of orderItems) {
        const targetId = item.variant_id ?? item.product_id;
        await incrementStock(admin, targetId, item.quantity).catch((e) =>
          req.log.error({ error: e, targetId }, "Stock rollback failed after coupon limit race")
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

router.get("/profile/orders/:id", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };
  const admin = getAdminSupabase();
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Fetch order — support full UUID (36 chars) or short ID (prefix match)
  let orderQuery = admin
    .from("orders")
    .select("id, status, customer_name, customer_phone, delivery_address, total_azn, discount_azn, created_at, user_id");

  if (id.length === 36) {
    orderQuery = orderQuery.eq("id", id);
  } else {
    orderQuery = orderQuery.like("id", `${id}%`);
  }

  const { data: order } = await orderQuery.maybeSingle();

  // Return 404 for both not-found and ownership mismatch (prevent enumeration)
  if (!order || order.user_id !== user.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Fetch order items
  const { data: items } = await admin
    .from("order_items")
    .select("id, product_id, quantity, product_price_snapshot, product_title_snapshot")
    .eq("order_id", order.id);

  // Fetch status history sorted by changed_at ASC
  const { data: history } = await (admin as any)
    .from("order_status_history")
    .select("id, old_status, new_status, changed_at, changed_by")
    .eq("order_id", order.id)
    .order("changed_at", { ascending: true });

  // Compute line_total for each item
  const order_items = (items ?? []).map((item: any) => ({
    id: item.id,
    product_id: item.product_id,
    quantity: item.quantity,
    product_price_snapshot: item.product_price_snapshot,
    product_title_snapshot: item.product_title_snapshot,
    line_total: item.quantity * item.product_price_snapshot,
  }));

  res.json({
    id: order.id,
    status: order.status,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    delivery_address: order.delivery_address,
    total_azn: order.total_azn,
    discount_azn: order.discount_azn,
    created_at: order.created_at,
    order_items,
    status_history: history ?? [],
  });
  return;
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
