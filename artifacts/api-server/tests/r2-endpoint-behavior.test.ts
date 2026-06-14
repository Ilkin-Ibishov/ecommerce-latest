import { describe, it, expect } from "vitest";
import { calculateDiscount } from "../src/lib/coupon-calc.ts";
import { mergeGuestCart, MAX_QUANTITY } from "../src/lib/cart-merge.js";
import type { CartEntry } from "../src/lib/cart-merge.js";

/**
 * Feature: architecture-refactoring — R2 endpoint convergence (example tests)
 *
 * These tests lock in the *corrected* (converged) behavior that the order /
 * coupon / cart endpoints now exhibit after delegating to the shared tested
 * functions `calculateDiscount` (lib/coupon-calc) and `mergeGuestCart`
 * (lib/cart-merge). This is the ONE sanctioned exception to behavior
 * preservation (Requirement 2):
 *
 *   - Order-with-coupon: the discount applied by `routes/orders.ts` and the
 *     amount returned by `POST /api/coupons/validate` are now 2-decimal rounded
 *     (the prior inline code skipped `Math.round`) and capped at the subtotal.
 *   - A coupon whose `min_order_amount` is not met yields NO discount
 *     (orders.ts leaves `discountAmount = 0`; /coupons/validate returns the
 *     400 error path) — never a partial/negative discount.
 *   - Cart-merge: a merge that would push a line over 99 is capped at 99 by
 *     `mergeGuestCart`, while `POST /api/cart/merge` keeps its response shape
 *     `{ merged: N }` where N is the number of guest items processed (NOT the
 *     post-cap quantity).
 *
 * The endpoints are thin pass-throughs to these functions (verified in
 * routes/orders.ts, routes/coupons.ts, routes/cart.ts), so asserting the
 * functions directly characterizes the endpoint-observable behavior without
 * requiring a live API server + Supabase. The full HTTP integration tests in
 * orders.test.ts / coupons.test.ts / cart.test.ts continue to exercise the
 * same behavior over the wire when the server/Supabase environment is
 * available.
 *
 * These assertions intentionally describe the CORRECTED behavior, not the old
 * divergent behavior.
 *
 * Validates: Requirements 2.3, 2.4, 2.6, 2.8
 */

describe("R2 order-with-coupon endpoint behavior (converged)", () => {
  /**
   * R2.3 — discount is rounded to exactly 2 decimal places.
   * Endpoint intent: orders.ts sets `discountAmount = result.discount_amount`
   * and /coupons/validate returns `discount_amount`. The prior inline order
   * math skipped rounding; the converged behavior rounds. 33.333% of 100 =
   * 33.333 -> rounded to 33.33.
   */
  it("rounds the applied discount to 2 decimals (was unrounded before convergence)", () => {
    const result = calculateDiscount(
      { discount_type: "percentage", discount_value: 33.333, min_order_amount: null },
      100,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discount_amount).toBe(33.33);
      // No more than 2 decimal places of precision.
      expect(Number.isInteger(result.discount_amount * 100)).toBe(true);
    }
  });

  /**
   * R2.3 — another rounding case that exposes float drift if rounding is
   * skipped. 15% of 99.99 = 14.9985 -> rounded to 15.00.
   */
  it("rounds half-up to 2 decimals for a typical percentage coupon", () => {
    const result = calculateDiscount(
      { discount_type: "percentage", discount_value: 15, min_order_amount: null },
      99.99,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discount_amount).toBe(15);
    }
  });

  /**
   * R2.4 — a discount larger than the subtotal is capped at the subtotal, so
   * the order total can never go negative. Fixed 500 off a 49.99 subtotal
   * caps to 49.99.
   */
  it("caps the discount at the order subtotal", () => {
    const subtotal = 49.99;
    const result = calculateDiscount(
      { discount_type: "fixed", discount_value: 500, min_order_amount: null },
      subtotal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discount_amount).toBe(subtotal);
      // total = subtotal - discount is never negative.
      expect(subtotal - result.discount_amount).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * R2.4 — a 100% percentage coupon caps exactly at subtotal (not above).
   */
  it("caps a 100% coupon exactly at the subtotal", () => {
    const subtotal = 123.45;
    const result = calculateDiscount(
      { discount_type: "percentage", discount_value: 100, min_order_amount: null },
      subtotal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discount_amount).toBe(subtotal);
    }
  });

  /**
   * R2.5 — a coupon whose min_order_amount is NOT met yields no discount.
   * Endpoint intent: orders.ts treats `result.ok === false` as "no discount
   * applied" (discountAmount stays 0); /coupons/validate maps it to the 400
   * error path. Subtotal 50 is below the 100 minimum.
   */
  it("applies no discount when subtotal is below the coupon min_order_amount", () => {
    const result = calculateDiscount(
      { discount_type: "percentage", discount_value: 10, min_order_amount: 100 },
      50,
    );

    expect(result.ok).toBe(false);
    // The order endpoint applies discountAmount = 0 in this branch, so the
    // observable effect is "no discount".
    const appliedDiscount = result.ok ? result.discount_amount : 0;
    expect(appliedDiscount).toBe(0);
  });

  /**
   * R2.5 boundary — at exactly the min_order_amount the coupon IS accepted and
   * the (rounded) discount applies.
   */
  it("applies the discount when subtotal exactly meets the min_order_amount", () => {
    const result = calculateDiscount(
      { discount_type: "percentage", discount_value: 10, min_order_amount: 100 },
      100,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discount_amount).toBe(10);
    }
  });
});

describe("R2 cart-merge endpoint behavior (converged)", () => {
  const toCartEntry = (product_id: string, quantity: number): CartEntry => ({
    product_id,
    quantity,
  });

  /**
   * R2.6 — a merge that would exceed 99 is capped at 99. Endpoint intent:
   * cart.ts persists `merged.mergedCart` (the capped quantities). 60 (user) +
   * 60 (guest) = 120 -> capped at 99.
   */
  it("caps a merged line quantity at MAX_QUANTITY (99) when it would exceed it", () => {
    const { mergedCart } = mergeGuestCart(
      [toCartEntry("prod-1", 60)],
      [toCartEntry("prod-1", 60)],
    );

    const line = mergedCart.find((e) => e.product_id === "prod-1");
    expect(line).toBeDefined();
    expect(line!.quantity).toBe(MAX_QUANTITY);
    expect(line!.quantity).toBe(99);
  });

  /**
   * R2.6 — a merge that stays at/below 99 is NOT capped (additive). 40 + 30 =
   * 70 remains 70.
   */
  it("keeps the additive quantity when the merged total stays within 99", () => {
    const { mergedCart } = mergeGuestCart(
      [toCartEntry("prod-2", 40)],
      [toCartEntry("prod-2", 30)],
    );

    const line = mergedCart.find((e) => e.product_id === "prod-2");
    expect(line).toBeDefined();
    expect(line!.quantity).toBe(70);
  });

  /**
   * R2.6 — the response shape `{ merged: N }` is preserved, where N is the
   * number of guest items processed, independent of the post-cap quantity.
   * The route returns `{ merged: guestItems.length }`; `mergeGuestCart`
   * reports the same count via `itemsMerged`.
   */
  it("reports merged count as the number of guest items, unaffected by the 99 cap", () => {
    const guestItems = [
      toCartEntry("prod-1", 60),
      toCartEntry("prod-3", 5),
    ];
    const { itemsMerged, mergedCart } = mergeGuestCart(
      [toCartEntry("prod-1", 60)],
      guestItems,
    );

    // Response count equals number of guest items (matches { merged: N }).
    expect(itemsMerged).toBe(guestItems.length);
    expect(itemsMerged).toBe(2);

    // And the capped line is still capped at 99 (the persisted quantity).
    const capped = mergedCart.find((e) => e.product_id === "prod-1");
    expect(capped!.quantity).toBe(99);
  });
});
