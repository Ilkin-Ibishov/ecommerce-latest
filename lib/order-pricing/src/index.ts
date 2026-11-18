/**
 * Order delivery and totals pricing (spec §7, delivery-cost note §5).
 * Pure, no I/O: shared between storefront and Express API server.
 * All arithmetic in whole qəpik.
 */

export interface DeliverySettings {
  delivery_fee_azn: number | null;
  free_delivery_threshold_azn: number | null;
}

export type DeliveryQuote =
  | null
  | {
      fee: number;
      remaining: number | null;
    };

const toQ = (azn: number) => Math.round(azn * 100);
const toAzn = (q: number) => q / 100;

/**
 * Computes delivery quote based on goods subtotal (coupon ignored) and shop settings.
 * Returns null when delivery fee is not known at checkout (setting is null).
 * Otherwise returns fee (0 when threshold is reached) and remaining amount to threshold.
 */
export function quoteDelivery(
  goodsSubtotal: number,
  settings: DeliverySettings,
): DeliveryQuote {
  if (settings.delivery_fee_azn === null || settings.delivery_fee_azn === undefined) {
    return null;
  }

  const feeQ = toQ(settings.delivery_fee_azn);
  const subtotalQ = toQ(goodsSubtotal);
  const thresholdQ =
    settings.free_delivery_threshold_azn !== null &&
    settings.free_delivery_threshold_azn !== undefined
      ? toQ(settings.free_delivery_threshold_azn)
      : null;

  if (feeQ <= 0 || subtotalQ <= 0) {
    return {
      fee: 0,
      remaining:
        feeQ > 0 && thresholdQ !== null && subtotalQ < thresholdQ
          ? toAzn(thresholdQ - Math.max(0, subtotalQ))
          : null,
    };
  }

  if (thresholdQ !== null) {
    if (subtotalQ >= thresholdQ) {
      return { fee: 0, remaining: null };
    }
    return {
      fee: toAzn(feeQ),
      remaining: toAzn(thresholdQ - subtotalQ),
    };
  }

  return {
    fee: toAzn(feeQ),
    remaining: null,
  };
}

/**
 * Computes goods total (subtotal - discount) in whole qəpik.
 */
export function goodsTotal(subtotal: number, discount: number): number {
  const subtotalQ = toQ(subtotal);
  const discountQ = toQ(discount);
  return toAzn(Math.max(0, subtotalQ - discountQ));
}

/**
 * Computes order total (subtotal - discount + delivery fee) in whole qəpik.
 */
export function orderTotal(subtotal: number, discount: number, fee: number): number {
  const subtotalQ = toQ(subtotal);
  const discountQ = toQ(discount);
  const feeQ = toQ(fee);
  return toAzn(Math.max(0, subtotalQ - discountQ) + feeQ);
}
