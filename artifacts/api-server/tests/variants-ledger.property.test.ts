import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { StockModel, StockLedgerError } from "./helpers/stock-model.ts";

describe("Variant Movement Ledger — Property-Based Tests", () => {
  /**
   * Property 1: Sum of ledger movement deltas strictly equals on_hand
   * Across any sequence of valid additions, deductions, adjustments, and receipts,
   * the variant on_hand balance strictly matches the sum of all movement deltas.
   */
  it("Property 1: Ledger delta sum matches on_hand invariant across arbitrary operations", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.array(
          fc.record({
            delta: fc.integer({ min: -50, max: 100 }),
            reason: fc.constantFrom(
              "purchase_receipt",
              "order_fulfillment",
              "return_restock",
              "damage_write_off",
              "stocktake_correction",
              "manual_adjustment"
            ),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (initial, operations) => {
          const model = new StockModel(initial);

          for (const op of operations) {
            try {
              model.applyMovement(op.delta, op.reason);
            } catch (err) {
              // Expected rejection when delta would drive stock below zero
              expect(err).toBeInstanceOf(StockLedgerError);
              expect((err as StockLedgerError).code).toBe("ST001");
            }

            // Invariant must hold at every intermediate step
            expect(model.onHand).toBeGreaterThanOrEqual(0);
            expect(model.onHand).toBe(model.ledgerSum);
          }

          // Final state check
          expect(model.onHand).toBeGreaterThanOrEqual(0);
          expect(model.onHand).toBe(model.ledgerSum);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Insufficient stock rejects with custom SQLSTATE ST001
   * Any deduction exceeding on_hand raises ST001, never generic P0001 or P0002.
   */
  it("Property 2: Insufficient stock rejects with custom SQLSTATE ST001", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (initial, excess) => {
          const model = new StockModel(initial);
          const deficitDelta = -(initial + excess);

          expect(() => model.applyMovement(deficitDelta, "order_fulfillment")).toThrowError(
            expect.objectContaining({ code: "ST001" })
          );

          // Stock and ledger sum must remain untouched
          expect(model.onHand).toBe(initial);
          expect(model.onHand).toBe(model.ledgerSum);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Direct update to on_hand is rejected with SQLSTATE 55000
   * Replicates trg_guard_variant_on_hand_update trigger behavior.
   */
  it("Property 3: Direct on_hand update is prohibited with SQLSTATE 55000", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (initial, target) => {
          const model = new StockModel(initial);

          expect(() => model.directUpdateOnHand(target)).toThrowError(
            expect.objectContaining({ code: "55000" })
          );

          expect(model.onHand).toBe(initial);
          expect(model.onHand).toBe(model.ledgerSum);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 4: Concurrent interleaved transactions never produce negative stock
   * Simulates Postgres row locking (SELECT ... FOR UPDATE) under concurrent requests.
   */
  it("Property 4: Concurrent transactions preserve non-negative invariant and ledger consistency", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 50 }),
        fc.array(fc.integer({ min: -10, max: 10 }), { minLength: 10, maxLength: 40 }),
        async (initialStock, deltas) => {
          const model = new StockModel(initialStock);

          // Mutex queue simulating PostgreSQL row-level lock on variant row
          let lock = Promise.resolve();
          const executeAtomicMovement = (delta: number) => {
            const next = lock.then(async () => {
              // Simulate small async IO delay during transaction
              await new Promise((r) => setTimeout(r, Math.random() * 2));
              try {
                model.applyMovement(delta, delta >= 0 ? "purchase_receipt" : "order_fulfillment");
                return { success: true, delta };
              } catch (e) {
                const err = e as StockLedgerError;
                expect(err.code).toBe("ST001");
                return { success: false, delta };
              }
            });
            lock = next.then(() => {});
            return next;
          };

          // Launch all operations concurrently
          await Promise.all(deltas.map((d) => executeAtomicMovement(d)));

          // After all concurrent operations resolve:
          expect(model.onHand).toBeGreaterThanOrEqual(0);
          expect(model.onHand).toBe(model.ledgerSum);
        }
      ),
      { numRuns: 30 }
    );
  });
});
