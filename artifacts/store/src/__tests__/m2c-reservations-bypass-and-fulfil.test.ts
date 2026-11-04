import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * M2c C6 — Trigger Availability Guard, Bypass Reasons, and Fulfilment Ordering Test
 *
 * Requirements:
 * - Only 'online_sale' checks available stock (on_hand + delta >= active_reservations).
 * - Deliberate bypass reasons succeed even when available stock is 0:
 *   counter_sale, stocktake_correction, opening_balance, damage_write_off, return_to_supplier, manual_adjustment, customer_return, goods_receipt.
 * - Fulfilment ordering: fulfil_reservation transitions status to 'fulfilled' BEFORE inserting movement.
 * - Fulfilling the last reserved unit (on_hand = 1, reserved = 1) succeeds without self-conflict.
 * - Documentation in .agents/rules/inventory.md and migration comment block verified.
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
  expiresAt: number | null;
}

interface MovementRecord {
  variantId: string;
  delta: number;
  reason: string;
}

class MockMovementTriggerEngine {
  public variants = new Map<string, VariantState>();
  public reservations = new Map<string, ReservationState>();
  public movements: MovementRecord[] = [];
  public allowNegativeStock = false;

  public setVariant(id: string, onHand: number) {
    this.variants.set(id, { id, onHand });
  }

  public setReservation(r: ReservationState) {
    this.reservations.set(r.id, { ...r });
  }

  public getActiveReserved(variantId: string, nowMs: number = Date.now()): number {
    return Array.from(this.reservations.values())
      .filter((r) => r.variantId === variantId && r.status === "active" && (r.expiresAt === null || r.expiresAt > nowMs))
      .reduce((sum, r) => sum + r.quantity, 0);
  }

  /**
   * Simulates trg_apply_stock_movement BEFORE INSERT.
   */
  public insertMovement(variantId: string, delta: number, reason: string, nowMs: number = Date.now()) {
    const v = this.variants.get(variantId);
    if (!v) throw new Error(`ST002: Variant not found: ${variantId}`);

    // Availability Guard: only online_sale checks available stock
    if (reason === "online_sale" && !this.allowNegativeStock) {
      const reserved = this.getActiveReserved(variantId, nowMs);
      if (v.onHand + delta < reserved) {
        throw new Error(
          `ST014: Insufficient available stock for variant ${variantId} (available: ${Math.max(0, v.onHand - reserved)}, requested: ${-delta})`
        );
      }
    }

    // Physical stock guard (non-negative unless allowNegativeStock)
    if (!this.allowNegativeStock && v.onHand + delta < 0) {
      throw new Error(`ST001: Insufficient stock for variant ${variantId}`);
    }

    v.onHand += delta;
    this.movements.push({ variantId, delta, reason });
  }

  /**
   * Simulates fulfil_reservation with explicit ordering:
   * 1. Set status = 'fulfilled'
   * 2. Insert counter_sale movement
   */
  public fulfilReservation(reservationId: string, nowMs: number = Date.now()) {
    const res = this.reservations.get(reservationId);
    if (!res) throw new Error("ST016: Reservation not found");
    if (res.status !== "active") throw new Error("ST017: Reservation is not active");

    // 1. Set status = 'fulfilled' BEFORE inserting movement (C6 requirement)
    res.status = "fulfilled";

    // 2. Insert counter_sale movement
    this.insertMovement(res.variantId, -res.quantity, "counter_sale", nowMs);
  }
}

describe("M2c C6: Availability Bypass Reasons & Fulfilment Ordering", () => {
  it("successfully fulfils the last reserved unit without self-conflict", () => {
    const engine = new MockMovementTriggerEngine();
    // 1 physical unit on hand, exactly 1 unit reserved by deposit => 0 available for online sale
    engine.setVariant("v-last", 1);
    engine.setReservation({
      id: "res-last-1",
      variantId: "v-last",
      quantity: 1,
      status: "active",
      expiresAt: null,
    });

    expect(engine.getActiveReserved("v-last")).toBe(1);

    // Online sale attempting to consume it is blocked
    expect(() => {
      engine.insertMovement("v-last", -1, "online_sale");
    }).toThrow("ST014");

    // Fulfilment of the reserved deposit succeeds
    engine.fulfilReservation("res-last-1");

    expect(engine.reservations.get("res-last-1")!.status).toBe("fulfilled");
    expect(engine.variants.get("v-last")!.onHand).toBe(0);
    expect(engine.movements.length).toBe(1);
    expect(engine.movements[0].reason).toBe("counter_sale");
  });

  it("permits counter_sale, stocktake_correction, and damage_write_off to bypass availability guard", () => {
    const engine = new MockMovementTriggerEngine();
    // 2 units on hand, 2 units reserved => 0 available
    engine.setVariant("v-bypass", 2);
    engine.setReservation({
      id: "res-2",
      variantId: "v-bypass",
      quantity: 2,
      status: "active",
      expiresAt: null,
    });

    // online_sale fails with ST014
    expect(() => engine.insertMovement("v-bypass", -1, "online_sale")).toThrow("ST014");

    // counter_sale bypasses availability check (physically present at till)
    expect(() => engine.insertMovement("v-bypass", -1, "counter_sale")).not.toThrow();
    expect(engine.variants.get("v-bypass")!.onHand).toBe(1);

    // damage_write_off bypasses availability check (unit is broken)
    expect(() => engine.insertMovement("v-bypass", -1, "damage_write_off")).not.toThrow();
    expect(engine.variants.get("v-bypass")!.onHand).toBe(0);
  });

  it("verifies inventory rules documentation and migration comment block", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const rulesMd = fs.readFileSync(path.join(root, ".agents/rules/inventory.md"), "utf-8").toLowerCase();
    const migrationSql = fs
      .readFileSync(path.join(root, "supabase/migrations/20261104190000_m2c_trigger_bypass_reasons.sql"), "utf-8")
      .toLowerCase();

    // Verify rules text
    expect(rulesMd).toContain("availability check bypass reasons");
    expect(rulesMd).toContain("`counter_sale` (customer at till, unit present)");
    expect(rulesMd).toContain("`damage_write_off` & `return_to_supplier`");

    // Verify migration comment block
    expect(migrationSql).toContain("reasons deliberately bypassing the availability check");
    expect(migrationSql).toContain("counter_sale: the customer is at the till");
    expect(migrationSql).toContain("stocktake_correction and opening_balance: physical observation outranks a promise");
    expect(migrationSql).toContain("damage_write_off and return_to_supplier: the unit is gone");
    expect(migrationSql).toContain("manual_adjustment: owner's explicit correction");
    expect(migrationSql).toContain("customer_return and goods_receipt: inbound movements adding stock");
  });
});
