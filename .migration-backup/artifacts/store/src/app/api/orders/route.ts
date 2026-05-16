import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendWhatsAppOrderConfirmation } from "@/lib/whatsapp/client";
import { z } from "zod";

const OrderSchema = z.object({
  items: z.array(
    z.object({
      product_id: z.string().uuid(),
      quantity: z.number().int().min(1),
    })
  ).min(1),
  customer_name: z.string().min(2),
  customer_phone: z.string().min(7),
  delivery_address: z.string().min(5),
  notes: z.string().optional(),
  coupon_code: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const admin = await createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: z.infer<typeof OrderSchema>;
  try {
    body = OrderSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Fetch all products to verify stock and get prices
  const productIds = body.items.map((i) => i.product_id);
  const { data: productsRaw, error: productsError } = await (admin as any)
    .from("products")
    .select("id, price, stock, product_translations(lang_code, title)")
    .in("id", productIds);

  if (productsError || !productsRaw) {
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }

  const products: any[] = productsRaw;
  const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));
  const orderItems: {
    product_id: string;
    product_title_snapshot: string;
    product_price_snapshot: number;
    quantity: number;
    line_total: number;
  }[] = [];

  let subtotal = 0;

  for (const item of body.items) {
    const product = productMap.get(item.product_id);
    if (!product) {
      return NextResponse.json({ error: `Product ${item.product_id} not found` }, { status: 400 });
    }
    if (product.stock < item.quantity) {
      return NextResponse.json(
        { error: `Insufficient stock for product ${item.product_id}` },
        { status: 400 }
      );
    }
    const title =
      (product.product_translations as any[])?.find((t: any) => t.lang_code === "az")?.title ??
      (product.product_translations as any[])?.[0]?.title ??
      "Product";
    const lineTotal = product.price * item.quantity;
    subtotal += lineTotal;
    orderItems.push({
      product_id: item.product_id,
      product_title_snapshot: title,
      product_price_snapshot: product.price,
      quantity: item.quantity,
      line_total: lineTotal,
    });
  }

  // Validate coupon if provided
  let discountAzn = 0;
  let couponId: string | null = null;

  if (body.coupon_code) {
    const { data: coupon } = await (admin as any)
      .from("coupons")
      .select("*")
      .eq("code", body.coupon_code.toUpperCase())
      .eq("is_active", true)
      .single() as { data: any };

    if (coupon) {
      const now = new Date().toISOString();
      const valid =
        (!coupon.starts_at || coupon.starts_at <= now) &&
        (!coupon.expires_at || coupon.expires_at >= now) &&
        (!coupon.max_uses || coupon.used_count < coupon.max_uses) &&
        (!coupon.min_order_amount || subtotal >= coupon.min_order_amount);

      if (valid) {
        discountAzn =
          coupon.discount_type === "percentage"
            ? (subtotal * coupon.discount_value) / 100
            : Math.min(coupon.discount_value, subtotal);
        couponId = coupon.id;
      }
    }
  }

  const totalAzn = Math.max(0, subtotal - discountAzn);

  // Create the order
  const { data: order, error: orderError } = await (admin as any)
    .from("orders")
    .insert({
      user_id: user.id,
      status: "pending",
      total_azn: totalAzn,
      discount_azn: discountAzn,
      coupon_id: couponId,
      delivery_address: body.delivery_address,
      customer_phone: body.customer_phone,
      customer_name: body.customer_name,
      notes: body.notes ?? null,
    })
    .select("id")
    .single() as { data: any; error: any };

  if (orderError || !order) {
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  // Insert order items
  await (admin as any).from("order_items").insert(
    orderItems.map((item) => ({ ...item, order_id: order.id }))
  );

  // Decrement stock
  await Promise.all(
    body.items.map(async (item) => {
      const product = productMap.get(item.product_id)!;
      await (admin as any)
        .from("products")
        .update({ stock: product.stock - item.quantity })
        .eq("id", item.product_id);
    })
  );

  // Track coupon usage
  if (couponId) {
    await (admin as any).from("coupon_usages").insert({
      coupon_id: couponId,
      user_id: user.id,
      order_id: order.id,
    });
    const oldCount = products.find((p: any) => p.id === couponId)?.used_count ?? 0;
    await (admin as any)
      .from("coupons")
      .update({ used_count: oldCount + 1 })
      .eq("id", couponId);
  }

  // Send WhatsApp confirmation (or console log in dev)
  await sendWhatsAppOrderConfirmation(body.customer_phone, order.id, totalAzn);

  return NextResponse.json({ success: true, orderId: order.id });
}
