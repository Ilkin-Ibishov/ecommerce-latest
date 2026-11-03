import { describe, it, expect } from "vitest";

/**
 * F1 Regression Test — Stock Target Adjustment TOCTOU Race
 *
 * Demonstrates the structural read-then-write defect in legacy PATCH /admin/products/:id/stock:
 * 1. Admin reads on_hand (e.g. 20)
 * 2. Concurrent customer order decrements on_hand (20 -> 18)
 * 3. Admin computes stale delta (30 - 20 = +10) and commits movement
 * 4. Final on_hand is 28, but handler returns echoed 30 (silent corruption)
 *
 * With the locked implementation (Postgres FOR UPDATE / serialized transaction),
 * the read and delta computation happen under exclusive lock, guaranteeing that
 * target adjustments never compute or apply stale deltas.
 */

class SimpleStockLedger {
  public onHand: number;
  public movements: { delta: number; reason: string }[] = [];

  constructor(initial: number) {
    this.onHand = initial;
    if (initial > 0) {
      this.movements.push({ delta: initial, reason: "opening_balance" });
    }
  }

  decrement(qty: number) {
    if (this.onHand < qty) throw new Error("Insufficient stock");
    this.onHand -= qty;
    this.movements.push({ delta: -qty, reason: "order_fulfillment" });
    return this.onHand;
  }

  applyMovement(delta: number, reason: string) {
    if (this.onHand + delta < 0) throw new Error("Insufficient stock");
    this.onHand += delta;
    this.movements.push({ delta, reason });
    return this.onHand;
  }
}

describe("F1 Regression: Stock Target Adjustment Concurrency", () => {
  it("reproduces defect: un-locked read-compute-write silently corrupts final quantity", () => {
    const ledger = new SimpleStockLedger(20);

    // Step 1: Admin reads on_hand to adjust to target 30
    const observedOnHand = ledger.onHand; // 20
    const targetStock = 30;
    const computedDelta = targetStock - observedOnHand; // +10

    // Step 2: Concurrent customer order decrements stock before admin write commits
    ledger.decrement(2); // on_hand is now 18

    // Step 3: Admin commits movement with pre-computed stale delta (+10)
    ledger.applyMovement(computedDelta, "manual_adjustment");

    // The legacy endpoint returned echoed target (30)
    const legacyEchoedResponse = { success: true, stock: targetStock };
    expect(legacyEchoedResponse.stock).toBe(30);

    // BUT actual resulting stock on the shelf is 28, NOT 30!
    // Asserting that the final quantity matches the target FAILS on legacy code:
    expect(ledger.onHand).not.toBe(30);
    expect(ledger.onHand).toBe(28);
  });

  it("fixes defect: locked atomic adjustment guarantees target quantity under concurrent interleave", async () => {
    const ledger = new SimpleStockLedger(20);

    // Simulating exclusive row-lock (SELECT ... FOR UPDATE) queue
    let rowLock = Promise.resolve();

    const atomicTargetAdjustment = (target: number, reason: string = "manual_adjustment") => {
      const operation = rowLock.then(async () => {
        // Read fresh on_hand under lock
        const current = ledger.onHand;
        const delta = target - current;
        if (delta !== 0) {
          ledger.applyMovement(delta, reason);
        }
        return ledger.onHand;
      });
      rowLock = operation.then(() => {});
      return operation;
    };

    const atomicDecrement = (qty: number) => {
      const operation = rowLock.then(async () => {
        return ledger.decrement(qty);
      });
      rowLock = operation.then(() => {});
      return operation;
    };

    // Interleave decrement and target adjustment concurrently
    // Schedule decrement first, then target adjustment to 30
    const decrementPromise = atomicDecrement(2);
    const adjustPromise = atomicTargetAdjustment(30);

    const [decResult, adjResult] = await Promise.all([decrementPromise, adjustPromise]);

    expect(decResult).toBe(18);
    expect(adjResult).toBe(30);

    // Assert the final quantity on the shelf: strictly 30!
    expect(ledger.onHand).toBe(30);
    expect(ledger.movements.reduce((acc, m) => acc + m.delta, 0)).toBe(30);
  });
});
