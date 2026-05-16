import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { code, subtotal } = await request.json();
  if (!code) return NextResponse.json({ error: "Coupon code required" }, { status: 400 });

  const admin = await createAdminClient();
  const { data: rawCoupon } = await (admin as any)
    .from("coupons")
    .select("*")
    .eq("code", code.toUpperCase())
    .eq("is_active", true)
    .single();

  const coupon = rawCoupon as any;

  if (!coupon) {
    return NextResponse.json({ error: "Invalid or expired coupon" }, { status: 404 });
  }

  const now = new Date().toISOString();
  if (coupon.starts_at && coupon.starts_at > now) {
    return NextResponse.json({ error: "Coupon is not active yet" }, { status: 400 });
  }
  if (coupon.expires_at && coupon.expires_at < now) {
    return NextResponse.json({ error: "Coupon has expired" }, { status: 400 });
  }
  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
    return NextResponse.json({ error: "Coupon has reached its usage limit" }, { status: 400 });
  }
  if (coupon.min_order_amount && subtotal < coupon.min_order_amount) {
    return NextResponse.json(
      { error: `Minimum order amount is ${coupon.min_order_amount} AZN` },
      { status: 400 }
    );
  }

  if (coupon.max_uses_per_user) {
    const { count } = await (admin as any)
      .from("coupon_usages")
      .select("*", { count: "exact", head: true })
      .eq("coupon_id", coupon.id)
      .eq("user_id", user.id);
    if ((count ?? 0) >= coupon.max_uses_per_user) {
      return NextResponse.json({ error: "You've already used this coupon" }, { status: 400 });
    }
  }

  const discount =
    coupon.discount_type === "percentage"
      ? (subtotal * coupon.discount_value) / 100
      : Math.min(coupon.discount_value, subtotal);

  return NextResponse.json({
    valid: true,
    coupon_id: coupon.id,
    discount_type: coupon.discount_type,
    discount_value: coupon.discount_value,
    discount_amount: discount,
    description: coupon.description,
  });
}
