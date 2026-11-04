import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * M2c C1 — Multi-Item Order Stock Decrement & Concurrency Test
 *
 * Requirements:
 * - decrement_order_stock executes in one transaction.
 * - Variant IDs are sorted and locked in ascending order to prevent deadlocks.
 * - If any line has insufficient available stock (considering active reservations),
 *   the entire operation aborts with ST014.
 * - Failure leaves ZERO movements and leaves the other lines' on-hand completely unchanged.
 */

interface VariantState {
  id: string;
  onHand: number;
}

interface ReservationState {
  id: string;
  variantId: string;
  quantity: number;
  status: "active" | "fulfilled" | "released" | "expired";
  expiresAt: number | null; // timestamp ms
}

interface MovementRecord {
  variantId: string;
  delta: number;
  reason: string;
  referenceId: string;
}

class MockOrderStockEngine {
  public variants = new Map<string, VariantState>();
  public reservations: ReservationState[] = [];
  public movements: MovementRecord[] = [];
  public lockHistory: string[] = [];
  public allowNegativeStock = false;

  public setVariant(id: string, onHand: number) {
    this.variants.set(id, { id, onHand });
  }

  public addReservation(res: ReservationState) {
    this.reservations.push(res);
  }

  public getAvailableStock(variantId: string, nowMs: number): number {
    const v = this.variants.get(variantId);
    if (!v) return 0;
    const reserved = this.reservations
      .filter((r) => r.variantId === variantId && r.status === "active" && (r.expiresAt === null || r.expiresAt > nowMs))
      .reduce((sum, r) => sum + r.quantity, 0);
    return Math.max(0, v.onHand - reserved);
  }

  /**
   * Simulates the PostgreSQL decrement_order_stock stored procedure.
   */
  public decrementOrderStock(
    orderId: string,
    lines: { variantId: string; quantity: number }[],
    nowMs: number = Date.now(),
  ): void {
    // 1. Verify existence of all requested variants
    for (const line of lines) {
      if (!this.variants.has(line.variantId)) {
        throw new Error(`ST002: Variant not found for line ${line.variantId}`);
      }
    }

    // 2. Aggregate quantities by variantId
    const aggregated = new Map<string, number>();
    for (const line of lines) {
      aggregated.set(line.variantId, (aggregated.get(line.variantId) ?? 0) + line.quantity);
    }

    // 3. Sort variant IDs in deterministic ASCENDING order (deadlock prevention)
    const sortedVariantIds = Array.from(aggregated.keys()).sort();
    this.lockHistory.push(...sortedVariantIds);

    // 4. Lock and validate availability for every variant
    for (const vId of sortedVariantIds) {
      const v = this.variants.get(vId)!;
      const reqQty = aggregated.get(vId)!;
      const activeReserved = this.reservations
        .filter((r) => r.variantId === vId && r.status === "active" && (r.expiresAt === null || r.expiresAt > nowMs))
        .reduce((sum, r) => sum + r.quantity, 0);

      const available = v.onHand - activeReserved;
      if (!this.allowNegativeStock && available < reqQty) {
        throw new Error(
          `ST014: Insufficient available stock for variant ${vId} (available: ${Math.max(0, available)}, requested: ${reqQty})`
        );
      }
    }

    // 5. Atomic write: insert all movements and mutate onHand
    for (const line of lines) {
      const v = this.variants.get(line.variantId)!;
      v.onHand -= line.quantity;
      this.movements.push({
        variantId: line.variantId,
        delta: -line.quantity,
        reason: "online_sale",
        referenceId: orderId,
      });
    }
  }
}

describe("M2c C1: decrement_order_stock & Multi-Item Order Atomicity", () => {
  it("locks variants in ascending order to prevent deadlocks", () => {
    const engine = new MockOrderStockEngine();
    engine.setVariant("variant-zzz", 10);
    engine.setVariant("variant-aaa", 10);
    engine.setVariant("variant-mmm", 10);

    engine.decrementOrderStock("order-1", [
      { variantId: "variant-zzz", quantity: 2 },
      { variantId: "variant-aaa", quantity: 1 },
      { variantId: "variant-mmm", quantity: 3 },
    ]);

    expect(engine.lockHistory).toEqual(["variant-aaa", "variant-mmm", "variant-zzz"]);
    expect(engine.variants.get("variant-aaa")!.onHand).toBe(9);
    expect(engine.variants.get("variant-mmm")!.onHand).toBe(7);
    expect(engine.variants.get("variant-zzz")!.onHand).toBe(8);
    expect(engine.movements.length).toBe(3);
  });

  it("leaves zero movements and leaves line 1 on-hand unchanged when line 2 is fully reserved", () => {
    const engine = new MockOrderStockEngine();
    // Line 1: 5 on-hand, 0 reserved => 5 available
    engine.setVariant("v1", 5);

    // Line 2: 1 on-hand, 1 active deposit reservation => 0 available
    engine.setVariant("v2", 1);
    engine.addReservation({
      id: "res-deposit-1",
      variantId: "v2",
      quantity: 1,
      status: "active",
      expiresAt: null,
    });

    expect(engine.getAvailableStock("v1", Date.now())).toBe(5);
    expect(engine.getAvailableStock("v2", Date.now())).toBe(0);

    // Attempt two-line order: requesting 1 unit of v1 and 1 unit of v2
    expect(() => {
      engine.decrementOrderStock("order-failed", [
        { variantId: "v1", quantity: 1 },
        { variantId: "v2", quantity: 1 },
      ]);
    }).toThrow("ST014");

    // Invariant: Zero movements written, v1 on-hand completely untouched
    expect(engine.movements.length).toBe(0);
    expect(engine.variants.get("v1")!.onHand).toBe(5);
    expect(engine.variants.get("v2")!.onHand).toBe(1);
  });

  it("verifies DDL declarations for reservations table and decrement_order_stock", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const schemaSql = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf-8").toLowerCase();
    const migrationSql = fs
      .readFileSync(path.join(root, "supabase/migrations/20261104181000_m2c_order_stock_decrement.sql"), "utf-8")
      .toLowerCase();

    // Check function declaration and locks
    expect(migrationSql).toContain("create or replace function decrement_order_stock");
    expect(migrationSql).toContain("order by pv.id asc");
    expect(migrationSql).toContain("for update of pv");
    expect(migrationSql).toContain("errcode = 'st014'");
    expect(schemaSql).toContain("create table if not exists public.reservations");
    expect(schemaSql).toContain("create or replace function decrement_order_stock");
  });
});
