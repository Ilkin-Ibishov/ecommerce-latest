export interface Coupon {
  discount_type: "percentage" | "fixed";
  discount_value: number;
  min_order_amount: number | null;
}

export type DiscountResult =
  | { ok: true; discount_amount: number }
  | { ok: false; error: string };

export function calculateDiscount(
  coupon: Coupon,
  subtotal: number,
): DiscountResult {
  if (coupon.min_order_amount != null && subtotal < coupon.min_order_amount) {
    return {
      ok: false,
      error: `Minimum order amount of ${coupon.min_order_amount} AZN required`,
    };
  }

  let discount: number;
  if (coupon.discount_type === "percentage") {
    discount = (subtotal * coupon.discount_value) / 100;
  } else {
    discount = coupon.discount_value;
  }

  discount = Math.min(discount, subtotal);
  discount = Math.round(discount * 100) / 100;

  return { ok: true, discount_amount: discount };
}
