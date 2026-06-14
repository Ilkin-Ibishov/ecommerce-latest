import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { calculateDiscount } from "../src/lib/coupon-calc.ts";

/**
 * Helper: generate a monetary value (2 decimal places) in a given range.
 * Uses integer cents to avoid floating-point representation issues.
 */
function money(min: number, max: number) {
  return fc.integer({ min: Math.ceil(min * 100), max: Math.floor(max * 100) }).map((cents) => cents / 100);
}

describe("coupon discount calculation properties", () => {
  /**
   * Property 1: Percentage discount matches model formula
   * For any percentage in (0, 100] and subtotal in [0.01, 99_999_999.99]
   * with no min_order_amount, discount === Math.round((subtotal * percentage) / 100 * 100) / 100
   *
   * Validates: Requirements 4.2, 4.6
   */
  it("percentage discount matches model formula", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        money(0.01, 99_999_999.99),
        (percentage, subtotal) => {
          const coupon = {
            discount_type: "percentage" as const,
            discount_value: percentage,
            min_order_amount: null,
          };

          const result = calculateDiscount(coupon, subtotal);

          expect(result.ok).toBe(true);
          if (result.ok) {
            const expected = Math.round((subtotal * percentage) / 100 * 100) / 100;
            expect(result.discount_amount).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 2: Fixed discount capped at subtotal
   * For any fixed discount_value in (0, 99_999_999.99] and subtotal in [0.01, 99_999_999.99],
   * discount === Math.min(discount_value, subtotal)
   *
   * Validates: Requirements 4.3
   */
  it("fixed discount capped at subtotal", () => {
    fc.assert(
      fc.property(
        money(0.01, 99_999_999.99),
        money(0.01, 99_999_999.99),
        (discountValue, subtotal) => {
          const coupon = {
            discount_type: "fixed" as const,
            discount_value: discountValue,
            min_order_amount: null,
          };

          const result = calculateDiscount(coupon, subtotal);

          expect(result.ok).toBe(true);
          if (result.ok) {
            const expected = Math.min(discountValue, subtotal);
            expect(result.discount_amount).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 3: Discount never exceeds subtotal
   * For any coupon type, any valid values, 0 <= discount_amount <= subtotal
   *
   * Validates: Requirements 4.7
   */
  it("discount never exceeds subtotal", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant("percentage" as const), fc.constant("fixed" as const)),
        money(0.01, 99_999_999.99),
        money(0.01, 99_999_999.99),
        (discountType, discountValue, subtotal) => {
          const coupon = {
            discount_type: discountType,
            discount_value: discountType === "percentage" ? Math.min(discountValue * 100, 100) : discountValue,
            min_order_amount: null,
          };

          const result = calculateDiscount(coupon, subtotal);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.discount_amount).toBeGreaterThanOrEqual(0);
            expect(result.discount_amount).toBeLessThanOrEqual(subtotal);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4: Below min_order_amount produces error
   * For any min_order_amount > 0 and subtotal < min_order_amount, result.ok === false
   *
   * Validates: Requirements 4.4
   */
  it("below min_order_amount produces error", () => {
    fc.assert(
      fc.property(
        money(0.02, 99_999_999.99),
        fc.oneof(fc.constant("percentage" as const), fc.constant("fixed" as const)),
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        (minOrderAmount, discountType, discountValue) => {
          // Generate subtotal strictly less than min_order_amount
          // Since min is at least 0.02, subtracting 0.01 gives at least 0.01
          const subtotal = Math.max(0.01, Math.round((minOrderAmount - 0.01) * 100) / 100);

          // Ensure subtotal is indeed less than minOrderAmount
          fc.pre(subtotal < minOrderAmount);

          const coupon = {
            discount_type: discountType,
            discount_value: discountType === "percentage" ? Math.min(discountValue, 100) : discountValue,
            min_order_amount: minOrderAmount,
          };

          const result = calculateDiscount(coupon, subtotal);

          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5: At min_order_amount boundary, coupon accepted
   * For any min_order_amount > 0 and subtotal === min_order_amount, result.ok === true
   *
   * Validates: Requirements 4.5
   */
  it("at min_order_amount boundary, coupon accepted", () => {
    fc.assert(
      fc.property(
        money(0.01, 99_999_999.99),
        fc.oneof(fc.constant("percentage" as const), fc.constant("fixed" as const)),
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        (minOrderAmount, discountType, discountValue) => {
          const coupon = {
            discount_type: discountType,
            discount_value: discountType === "percentage" ? Math.min(discountValue, 100) : discountValue,
            min_order_amount: minOrderAmount,
          };

          // Set subtotal exactly equal to min_order_amount
          const result = calculateDiscount(coupon, minOrderAmount);

          expect(result.ok).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("architecture-refactoring coupon discount properties", () => {
  /**
   * Feature: architecture-refactoring, Property 1: Discount is bounded and rounded to 2 decimals
   *
   * For any coupon (percentage or fixed) and any non-negative subtotal for which the
   * coupon is accepted (ok === true), 0 <= discount_amount <= subtotal AND
   * discount_amount === Math.round(min(rawDiscount, subtotal) * 100) / 100.
   *
   * Validates: Requirements 2.3, 2.4, 2.5
   */
  it("discount is bounded and rounded to 2 decimals", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant("percentage" as const), fc.constant("fixed" as const)),
        money(0, 99_999_999.99),
        money(0, 99_999_999.99),
        (discountType, discountValue, subtotal) => {
          const coupon = {
            discount_type: discountType,
            discount_value: discountValue,
            min_order_amount: null,
          };

          const result = calculateDiscount(coupon, subtotal);

          // With min_order_amount null, the coupon is always accepted.
          expect(result.ok).toBe(true);
          if (result.ok) {
            const rawDiscount =
              discountType === "percentage" ? (subtotal * discountValue) / 100 : discountValue;
            const expected = Math.round(Math.min(rawDiscount, subtotal) * 100) / 100;

            expect(result.discount_amount).toBe(expected);
            expect(result.discount_amount).toBeGreaterThanOrEqual(0);
            expect(result.discount_amount).toBeLessThanOrEqual(subtotal);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Feature: architecture-refactoring, Property 2: Coupons below minimum order are rejected with no discount
   *
   * For any coupon with min_order_amount set and subtotal strictly below it,
   * calculateDiscount returns { ok: false }.
   *
   * Validates: Requirements 2.3, 2.4, 2.5
   */
  it("coupons below minimum order are rejected with no discount", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant("percentage" as const), fc.constant("fixed" as const)),
        money(0.01, 99_999_999.99),
        money(0.02, 99_999_999.99),
        (discountType, discountValue, minOrderAmount) => {
          // Generate a subtotal strictly less than min_order_amount.
          const subtotal = Math.max(0, Math.round((minOrderAmount - 0.01) * 100) / 100);
          fc.pre(subtotal < minOrderAmount);

          const coupon = {
            discount_type: discountType,
            discount_value: discountType === "percentage" ? Math.min(discountValue, 100) : discountValue,
            min_order_amount: minOrderAmount,
          };

          const result = calculateDiscount(coupon, subtotal);

          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
