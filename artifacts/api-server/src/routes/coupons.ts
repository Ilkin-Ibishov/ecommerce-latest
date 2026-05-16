import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";

const router = Router();

router.post("/coupons/validate", async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) return res.status(400).json({ error: "Coupon code is required" });

    const admin = getAdminSupabase();
    const { data: coupon } = await (admin as any)
      .from("coupons")
      .select("*")
      .eq("code", code.trim().toUpperCase())
      .eq("is_active", true)
      .maybeSingle();

    if (!coupon) return res.status(404).json({ error: "Invalid or expired coupon" });

    const now = new Date();
    if (coupon.expires_at && new Date(coupon.expires_at) <= now) {
      return res.status(400).json({ error: "Coupon has expired" });
    }
    if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
      return res.status(400).json({ error: "Coupon usage limit reached" });
    }
    if (coupon.min_order_amount && subtotal < coupon.min_order_amount) {
      return res.status(400).json({
        error: `Minimum order amount of ${coupon.min_order_amount} AZN required`,
      });
    }

    let discountAmount = 0;
    if (coupon.discount_type === "percentage") {
      discountAmount = (subtotal * coupon.discount_value) / 100;
    } else {
      discountAmount = coupon.discount_value;
    }
    discountAmount = Math.min(discountAmount, subtotal);

    return res.json({
      id: coupon.id,
      code: coupon.code,
      description: coupon.description,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      discount_amount: discountAmount,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
