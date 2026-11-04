import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * M2c C2 — Reservation Fulfilment and Final Payment Atomicity Test
 *
 * Requirements:
 * - fulfil_reservation applies final payment and fulfilment in one transaction.
 * - After applying final payment, paid_amount must equal agreed_price,
 *   otherwise raises ST015 naming the shortfall.
 * - If ST015 is raised, nothing is changed (transaction rolled back).
 * - On success, ends status = 'fulfilled', paid_amount updated, and counter_sale movement recorded.
 */

interface MockReservation {
  id: string;
  variantId: string;
  quantity: number;
  status: "active" | "fulfilled" | "released" | "expired";
  agreedPrice: number;
  paidAmount: number;
  fulfilledBy?: string;
  fulfilledAt?: number;
}

interface MockMovement {
  variantId: string;
  delta: number;
  reason: string;
  referenceType: string;
  referenceId: string;
  actorId: string;
}

class MockFulfilmentEngine {
  public reservations = new Map<string, MockReservation>();
  public onHand = new Map<string, number>();
  public movements: MockMovement[] = [];

  public setVariant(id: string, initialOnHand: number) {
    this.onHand.set(id, initialOnHand);
  }

  public setReservation(res: MockReservation) {
    this.reservations.set(res.id, { ...res });
  }

  /**
   * Simulates Postgres fulfil_reservation stored procedure.
   */
  public fulfilReservation(
    reservationId: string,
    actorId: string,
    finalPayment: number = 0,
    nowMs: number = Date.now()
  ): MockReservation {
    const res = this.reservations.get(reservationId);
    if (!res) {
      throw new Error(`ST016: Reservation not found: ${reservationId}`);
    }

    if (res.status !== "active") {
      throw new Error(`ST017: Reservation is not active: ${res.status}`);
    }

    const newPaid = res.paidAmount + finalPayment;
    if (newPaid !== res.agreedPrice) {
      const shortfall = res.agreedPrice - newPaid;
      throw new Error(`ST015: Shortfall of ${shortfall} AZN: total paid ${newPaid} does not equal agreed price ${res.agreedPrice}`);
    }

    // C6 requirement: Set reservation out of active state BEFORE inserting movement
    res.status = "fulfilled";
    res.paidAmount = newPaid;
    res.fulfilledBy = actorId;
    res.fulfilledAt = nowMs;

    // Record physical stock exit
    const currentStock = this.onHand.get(res.variantId) ?? 0;
    this.onHand.set(res.variantId, currentStock - res.quantity);
    this.movements.push({
      variantId: res.variantId,
      delta: -res.quantity,
      reason: "counter_sale",
      referenceType: "reservation",
      referenceId: reservationId,
      actorId,
    });

    return { ...res };
  }
}

describe("M2c C2: fulfil_reservation with Final Payment & ST015 Guard", () => {
  it("rejects fulfilment with ST015 naming the shortfall when balance is insufficient, leaving state untouched", () => {
    const engine = new MockFulfilmentEngine();
    engine.setVariant("coat-var-1", 1);
    engine.setReservation({
      id: "res-coat-1",
      variantId: "coat-var-1",
      quantity: 1,
      status: "active",
      agreedPrice: 50,
      paidAmount: 20,
    });

    // Attempt to fulfil with finalPayment = 10 (20 + 10 = 30 < 50 => shortfall 20)
    expect(() => {
      engine.fulfilReservation("res-coat-1", "staff-user-1", 10);
    }).toThrow(/ST015: Shortfall of 20 AZN/);

    // Verify nothing changed
    const res = engine.reservations.get("res-coat-1")!;
    expect(res.status).toBe("active");
    expect(res.paidAmount).toBe(20);
    expect(engine.onHand.get("coat-var-1")).toBe(1);
    expect(engine.movements.length).toBe(0);
  });

  it("succeeds when final payment equals remaining balance, ending fulfilled with paid_amount = agreed_price", () => {
    const engine = new MockFulfilmentEngine();
    engine.setVariant("coat-var-1", 1);
    engine.setReservation({
      id: "res-coat-1",
      variantId: "coat-var-1",
      quantity: 1,
      status: "active",
      agreedPrice: 50,
      paidAmount: 20,
    });

    // Fulfil with finalPayment = 30 (20 + 30 = 50 == agreedPrice)
    const fulfilled = engine.fulfilReservation("res-coat-1", "staff-user-1", 30);

    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.paidAmount).toBe(50);
    expect(engine.onHand.get("coat-var-1")).toBe(0);
    expect(engine.movements.length).toBe(1);
    expect(engine.movements[0]).toMatchObject({
      variantId: "coat-var-1",
      delta: -1,
      reason: "counter_sale",
      referenceType: "reservation",
      referenceId: "res-coat-1",
      actorId: "staff-user-1",
    });
  });

  it("verifies SQL migration and schema declaration for fulfil_reservation and ST015", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const schemaSql = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf-8").toLowerCase();
    const migrationSql = fs
      .readFileSync(path.join(root, "supabase/migrations/20261104182000_m2c_deposit_fulfilment.sql"), "utf-8")
      .toLowerCase();

    expect(migrationSql).toContain("create or replace function fulfil_reservation");
    expect(migrationSql).toContain("errcode = 'st015'");
    expect(migrationSql).toContain("status = 'fulfilled'");
    expect(migrationSql).toContain("counter_sale");
    expect(schemaSql).toContain("create or replace function fulfil_reservation");
  });
});
