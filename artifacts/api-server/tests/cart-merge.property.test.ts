import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { mergeGuestCart, MAX_QUANTITY } from "../src/lib/cart-merge.js";
import type { CartEntry } from "../src/lib/cart-merge.js";

/**
 * Cart Merge Idempotency Property Tests
 * Feature: testing-expansion
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5
 */

/** Generate a cart entry with a specific product_id prefix to control overlap */
function cartEntryArb(idPrefix: string, count: number): fc.Arbitrary<CartEntry[]> {
  return fc
    .array(
      fc.record({
        product_id: fc.integer({ min: 1, max: 1000 }).map((n) => `${idPrefix}-${n}`),
        quantity: fc.integer({ min: 1, max: 50 }),
      }),
      { minLength: 1, maxLength: count },
    )
    .map((entries) => {
      // Deduplicate by product_id within a single cart, keeping last entry
      const map = new Map<string, number>();
      for (const e of entries) {
        map.set(e.product_id, e.quantity);
      }
      return Array.from(map.entries()).map(([product_id, quantity]) => ({
        product_id,
        quantity,
      }));
    });
}

describe("Cart Merge Property Tests", () => {
  /**
   * Property 9: Disjoint guest cart merge preserves quantities
   * Validates: Requirements 6.2, 6.5
   *
   * For any user cart and guest cart with completely disjoint product_id sets
   * (each with 1-10 items, quantities in [1, 50]), merging the guest cart into
   * the user cart produces a result containing every product from both carts
   * with their original quantities unchanged.
   */
  it("Property 9: Disjoint guest cart merge preserves quantities", () => {
    fc.assert(
      fc.property(
        cartEntryArb("user", 10),
        cartEntryArb("guest", 10),
        (userCart, guestCart) => {
          // Ensure carts are truly disjoint by prefixing
          const disjointUserCart: CartEntry[] = userCart.map((e) => ({
            product_id: `u-${e.product_id}`,
            quantity: e.quantity,
          }));
          const disjointGuestCart: CartEntry[] = guestCart.map((e) => ({
            product_id: `g-${e.product_id}`,
            quantity: e.quantity,
          }));

          const { mergedCart } = mergeGuestCart(disjointUserCart, disjointGuestCart);

          // Merged cart should contain all items from both carts
          const mergedMap = new Map(
            mergedCart.map((e) => [e.product_id, e.quantity]),
          );

          // All user cart items present with original quantities
          for (const item of disjointUserCart) {
            expect(mergedMap.get(item.product_id)).toBe(item.quantity);
          }

          // All guest cart items present with original quantities
          for (const item of disjointGuestCart) {
            expect(mergedMap.get(item.product_id)).toBe(item.quantity);
          }

          // Total items is sum of both carts
          expect(mergedCart.length).toBe(
            disjointUserCart.length + disjointGuestCart.length,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 10: Overlapping merge is additive with cap at 99
   * Validates: Requirements 6.3
   *
   * For any user cart and guest cart sharing at least one product_id
   * (quantities in [1, 50] each), the merged cart contains each overlapping
   * product with quantity equal to min(user_qty + guest_qty, 99).
   */
  it("Property 10: Overlapping merge is additive with cap at 99", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            product_id: fc.integer({ min: 1, max: 20 }).map((n) => `product-${n}`),
            userQty: fc.integer({ min: 1, max: 50 }),
            guestQty: fc.integer({ min: 1, max: 50 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (overlappingItems) => {
          // Deduplicate by product_id to get a clean overlapping set
          const itemMap = new Map<
            string,
            { userQty: number; guestQty: number }
          >();
          for (const item of overlappingItems) {
            itemMap.set(item.product_id, {
              userQty: item.userQty,
              guestQty: item.guestQty,
            });
          }

          const userCart: CartEntry[] = Array.from(itemMap.entries()).map(
            ([product_id, { userQty }]) => ({ product_id, quantity: userQty }),
          );
          const guestCart: CartEntry[] = Array.from(itemMap.entries()).map(
            ([product_id, { guestQty }]) => ({ product_id, quantity: guestQty }),
          );

          const { mergedCart } = mergeGuestCart(userCart, guestCart);

          const mergedMap = new Map(
            mergedCart.map((e) => [e.product_id, e.quantity]),
          );

          // Each overlapping product should have additive quantity capped at MAX_QUANTITY
          for (const [product_id, { userQty, guestQty }] of itemMap.entries()) {
            const expected = Math.min(userQty + guestQty, MAX_QUANTITY);
            expect(mergedMap.get(product_id)).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 11: Cart merge is idempotent
   * Validates: Requirements 6.4
   *
   * For any user cart and guest cart, applying the merge once and then
   * applying the same merge again (with guest cart now empty since items
   * were consumed) produces the same final cart state, with the second
   * merge reporting zero items merged.
   */
  it("Property 11: Cart merge is idempotent", () => {
    fc.assert(
      fc.property(
        cartEntryArb("user", 10),
        cartEntryArb("guest", 10),
        (userCart, guestCart) => {
          // First merge
          const firstResult = mergeGuestCart(userCart, guestCart);

          // Second merge with empty guest cart (items were consumed)
          const secondResult = mergeGuestCart(firstResult.mergedCart, []);

          // Same cart state after second merge
          const firstMap = new Map(
            firstResult.mergedCart.map((e) => [e.product_id, e.quantity]),
          );
          const secondMap = new Map(
            secondResult.mergedCart.map((e) => [e.product_id, e.quantity]),
          );

          expect(secondMap.size).toBe(firstMap.size);
          for (const [id, qty] of firstMap.entries()) {
            expect(secondMap.get(id)).toBe(qty);
          }

          // Second merge reports 0 items merged (empty guest cart)
          expect(secondResult.itemsMerged).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
