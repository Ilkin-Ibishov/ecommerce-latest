import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { StockModel } from "./helpers/stock-model.ts";

describe("Stock Decrement Safety — Property-Based Tests", () => {
  /**
   * Property 6: Stock decrement reduces by exact quantity
   * For any initial stock in [1, 1000] and any decrement quantity in [1, initial_stock],
   * the stock model SHALL produce a remaining value equal to initial_stock - quantity.
   *
   * Validates: Requirements 5.3
   */
  it("Property 6: Stock decrement reduces by exact quantity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }).chain((initial) =>
          fc.tuple(fc.constant(initial), fc.integer({ min: 1, max: initial }))
        ),
        ([initial, qty]) => {
          const model = new StockModel(initial);
          const result = model.decrement(qty);

          expect(result.ok).toBe(true);
          expect(result.remaining).toBe(initial - qty);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Zero stock rejects all decrements
   * For any decrement quantity >= 1 applied to a product with zero stock,
   * the stock model SHALL raise an error and leave stock unchanged at zero.
   *
   * Validates: Requirements 5.4
   */
  it("Property 7: Zero stock rejects all decrements", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (qty) => {
        const model = new StockModel(0);
        const result = model.decrement(qty);

        expect(result.ok).toBe(false);
        expect(result.remaining).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Stock never goes negative under any operation sequence
   * For any initial stock in [0, 1000] and any sequence of 1 to 20 decrement
   * operations (each with quantity in [1, 100]), after applying the full sequence
   * (skipping operations that would go negative), the stock SHALL remain >= 0
   * at every intermediate step.
   *
   * Validates: Requirements 5.2, 5.5
   */
  it("Property 8: Stock never goes negative under any sequence", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 20 }),
        (initial, ops) => {
          const model = new StockModel(initial);

          for (const qty of ops) {
            const result = model.decrement(qty);
            if (!result.ok) {
              // Operation was rejected — stock unchanged, still >= 0
              expect(model.current).toBeGreaterThanOrEqual(0);
            } else {
              // Operation succeeded — stock should still be >= 0
              expect(model.current).toBeGreaterThanOrEqual(0);
            }
          }

          // Final stock must be >= 0
          expect(model.current).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
