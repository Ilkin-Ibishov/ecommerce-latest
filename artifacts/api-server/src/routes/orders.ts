import { Router } from "express";
import { getSupabase, getAdminSupabase } from "../lib/supabase";
import { sendWhatsAppStatusUpdate } from "../lib/whatsapp";

const router = Router();

const VALID_STATUSES = [
  "pending", "phone_verified", "courier_assigned", "shipped",
  "delivered", "refused_at_delivery", "cancelled",
];

router.post("/orders", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { items, customer_name, customer_phone, delivery_address, notes, coupon_code } = req.body;

    if (!items?.length || !customer_name || !customer_phone || !delivery_address) {
      return res.status(400).json({ error: "Missing required order fields" });
    }

    const admin = getAdminSupabase();

    const productIds = items.map((i: any) => i.product_id);
    const { data: products } = await (admin as any)
      .from("products")
      .select("id, price, stock, product_translations(lang_code, title)")
      .in("id", productIds);

    if (!products) return res.status(500).json({ error: "Failed to fetch products" });

    const productMap = new Map(products.map((p: any) => [p.id, p]));
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = productMap.get(item.product_id);
      if (!product) return res.status(400).json({ error: `Product not found: ${item.product_id}` });
      if (product.stock < item.quantity) return res.status(400).json({ error: `Insufficient stock for product ${item.product_id}` });
      const title = (product.product_translations as any[]).find((t: any) => t.lang_code === "az")?.title
        ?? (product.product_translations as any[])[0]?.title ?? "Product";
      const lineTotal = product.price * item.quantity;
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

    if (coupon_code) {
      const { data: coupon } = await (admin as any)
        .from("coupons")
        .select("*")
        .eq("code", coupon_code.trim().toUpperCase())
        .eq("is_active", true)
        .maybeSingle();

      if (coupon) {
        const now = new Date();
        const notExpired = !coupon.expires_at || new Date(coupon.expires_at) > now;
        const withinMaxUses = !coupon.max_uses || coupon.used_count < coupon.max_uses;
        const meetsMin = !coupon.min_order_amount || subtotal >= coupon.min_order_amount;

        if (notExpired && withinMaxUses && meetsMin) {
          if (coupon.discount_type === "percentage") {
            discountAmount = (subtotal * coupon.discount_value) / 100;
          } else {
            discountAmount = coupon.discount_value;
          }
          discountAmount = Math.min(discountAmount, subtotal);
          couponId = coupon.id;
          await (admin as any).from("coupons").update({ used_count: coupon.used_count + 1 }).eq("id", coupon.id);
        }
      }
    }

    const totalAzn = subtotal - discountAmount;

    const { data: order, error: orderError } = await (admin as any)
      .from("orders")
      .insert({
        user_id: user.id,
        status: "pending",
        customer_name,
        customer_phone,
        delivery_address,
        notes: notes ?? null,
        subtotal_azn: subtotal,
        discount_azn: discountAmount,
        total_azn: totalAzn,
        coupon_id: couponId,
      })
      .select("id")
      .single();

    if (orderError) throw orderError;

    await (admin as any).from("order_items").insert(
      orderItems.map((item) => ({ ...item, order_id: order.id }))
    );

    for (const item of items) {
      const product = productMap.get(item.product_id);
      await (admin as any).from("products").update({ stock: product.stock - item.quantity }).eq("id", item.product_id);
    }

    return res.status(201).json({ success: true, orderId: order.id });
  } catch (err) {
    req.log.error(err, "[Orders POST] Error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const admin = getAdminSupabase();
    const { data: order } = await (admin as any)
      .from("orders").select("*,order_items(*)").eq("id", req.params.id).single();

    if (!order || order.user_id !== user.id) {
      const { data: profile } = await (admin as any).from("users").select("role").eq("id", user.id).single();
      if (profile?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(order);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
