import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";
import { calculateDiscount } from "../lib/coupon-calc";

const router = Router();

router.post("/coupons/validate", async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code) return res.status(400).json({ error: "Coupon code is required" });

  const admin = getAdminSupabase();
  const { data: coupon } = await admin
    .from("coupons")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .eq("is_active", true)
    .maybeSingle();

  if (!coupon) return res.status(400).json({ error: "Invalid or expired coupon" });

  const now = new Date();
  if (coupon.expires_at && new Date(coupon.expires_at) <= now) {
    return res.status(400).json({ error: "Coupon has expired" });
  }
  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
    return res.status(400).json({ error: "Coupon usage limit reached" });
  }

  const result = calculateDiscount(
    {
      discount_type: coupon.discount_type as "percentage" | "fixed",
      discount_value: coupon.discount_value,
      min_order_amount: coupon.min_order_amount,
    },
    subtotal,
  );
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  return res.json({
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    discount_type: coupon.discount_type,
    discount_value: coupon.discount_value,
    discount_amount: result.discount_amount,
  });
});

export default router;
