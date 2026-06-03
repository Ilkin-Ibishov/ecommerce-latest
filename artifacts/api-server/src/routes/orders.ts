import { Router } from "express";
import { getSupabase, getAdminSupabase } from "../lib/supabase";
import { queueNotification } from "../lib/notifications";

const router = Router();

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

    const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = productMap.get(item.product_id);
      if (!product) return res.status(400).json({ error: `Product not found: ${item.product_id}` });
      if (product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock`, product_id: item.product_id });
      }
      const title = (product.product_translations as any[]).find((t: any) => t.lang_code === "az")?.title
        ?? (product.product_translations as any[])[0]?.title ?? "Product";
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
    let couponData: any = null;

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
          discountAmount = coupon.discount_type === "percentage"
            ? (subtotal * coupon.discount_value) / 100
            : coupon.discount_value;
          discountAmount = Math.min(discountAmount, subtotal);
          couponId = coupon.id;
          couponData = coupon;
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

    // Atomic stock deduction — use RPC if available, else conditional update
    for (const item of items) {
      const product: any = productMap.get(item.product_id);
      const { error: stockErr } = await (admin as any).rpc("decrement_stock_safe", {
        p_product_id: item.product_id,
        p_qty: item.quantity,
      });
      if (stockErr) {
        // Fallback: conditional update (protects against race condition via WHERE stock >= qty)
        const { data: updated } = await (admin as any)
          .from("products")
          .update({ stock: product.stock - item.quantity })
          .eq("id", item.product_id)
          .gte("stock", item.quantity)
          .select("id");
        if (!updated || updated.length === 0) {
          // Race condition: stock depleted between check and update
          // Rollback by deleting the order (best-effort)
          await (admin as any).from("orders").delete().eq("id", order.id);
          return res.status(409).json({ error: `Out of stock: ${item.product_id}` });
        }
      }
    }

    // Record coupon usage
    if (couponId && couponData) {
      await (admin as any).from("coupons").update({ used_count: (couponData.used_count ?? 0) + 1 }).eq("id", couponId);
      await (admin as any).from("coupon_usages").insert({
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
  } catch (err) {
    req.log.error(err, "[Orders POST] Error");
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
    const { data: orders, error } = await (admin as any)
      .from("orders")
      .select("*, order_items(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json(orders ?? []);
  } catch (err) {
    req.log.error(err, "[Profile Orders GET] Error");
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
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", req.params.id)
      .single();

    if (!order) return res.status(404).json({ error: "Not found" });

    if (order.user_id !== user.id) {
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
