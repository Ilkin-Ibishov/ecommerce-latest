import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * M2c C3 — Unified effective_status & Temporal Expiration Test
 *
 * Requirements:
 * - Single source of truth for effective_status computed in the database.
 * - 'released' and 'fulfilled' pass through.
 * - 'active' with expires_at in the past becomes 'expired'.
 * - Otherwise 'active'.
 * - Stored 'status' column remains 'active' (nothing writes 'expired' automatically).
 * - Expired reservations are excluded from reserved_quantity (availability unblocked).
 * - Expired reservations still appear in the aged list so the owner can review/act on them.
 */

interface ReservationRow {
  id: string;
  reservationNumber: string;
  variantId: string;
  quantity: number;
  status: "active" | "fulfilled" | "released" | "expired";
  expiresAt: number | null; // timestamp ms
  createdAt: number;
}

class MockEffectiveStatusEngine {
  public reservations: ReservationRow[] = [];
  public onHand = new Map<string, number>();

  public setVariant(id: string, qty: number) {
    this.onHand.set(id, qty);
  }

  public addReservation(row: ReservationRow) {
    this.reservations.push(row);
  }

  /**
   * Simulates the SQL reservations_view computed column:
   * CASE
   *   WHEN r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now() THEN 'expired'
   *   ELSE r.status
   * END AS effective_status
   */
  public getReservationsView(nowMs: number = Date.now()) {
    return this.reservations.map((r) => {
      let effectiveStatus: "active" | "fulfilled" | "released" | "expired" = r.status;
      if (r.status === "active" && r.expiresAt !== null && r.expiresAt < nowMs) {
        effectiveStatus = "expired";
      }
      return {
        ...r,
        effectiveStatus,
      };
    });
  }

  /**
   * Simulates product_variant_availability:
   * SUM of reservations where status = 'active' AND (expires_at IS NULL OR expires_at > now())
   */
  public getReservedQuantity(variantId: string, nowMs: number = Date.now()): number {
    return this.reservations
      .filter((r) => r.variantId === variantId && r.status === "active" && (r.expiresAt === null || r.expiresAt > nowMs))
      .reduce((sum, r) => sum + r.quantity, 0);
  }

  public getAvailableQuantity(variantId: string, nowMs: number = Date.now()): number {
    const onHand = this.onHand.get(variantId) ?? 0;
    const reserved = this.getReservedQuantity(variantId, nowMs);
    return Math.max(0, onHand - reserved);
  }

  /**
   * Simulates aged list query:
   * Returns reservations that are either:
   * 1. effective_status = 'expired'
   * 2. active deposits older than threshold (e.g. 7 days old)
   */
  public getAgedReservations(thresholdAgeMs: number, nowMs: number = Date.now()) {
    const view = this.getReservationsView(nowMs);
    return view.filter((r) => {
      if (r.effectiveStatus === "expired") return true;
      if (r.effectiveStatus === "active" && nowMs - r.createdAt >= thresholdAgeMs) return true;
      return false;
    });
  }
}

describe("M2c C3: Unified effective_status & Expiration Exclusion", () => {
  it("reports effective_status = 'expired', excludes from reserved_quantity, and appears in aged list", () => {
    const engine = new MockEffectiveStatusEngine();
    const now = 1700000000000;
    const oneHourAgo = now - 3600 * 1000;

    engine.setVariant("var-jacket", 5);

    // Expired hold: status is stored as 'active', expiresAt was 1 hour ago
    engine.addReservation({
      id: "res-hold-1",
      reservationNumber: "RES-001",
      variantId: "var-jacket",
      quantity: 2,
      status: "active",
      expiresAt: oneHourAgo,
      createdAt: oneHourAgo - 1000,
    });

    // Active deposit without expiry (NULL expires_at)
    engine.addReservation({
      id: "res-deposit-2",
      reservationNumber: "RES-002",
      variantId: "var-jacket",
      quantity: 1,
      status: "active",
      expiresAt: null,
      createdAt: now - 1000,
    });

    const rows = engine.getReservationsView(now);
    const holdRow = rows.find((r) => r.id === "res-hold-1")!;
    const depositRow = rows.find((r) => r.id === "res-deposit-2")!;

    // 1. effective_status test
    expect(holdRow.effectiveStatus).toBe("expired");
    expect(holdRow.status).toBe("active"); // stored status remains untouched
    expect(depositRow.effectiveStatus).toBe("active");

    // 2. reserved_quantity excludes expired hold: only deposit (1 unit) is reserved
    expect(engine.getReservedQuantity("var-jacket", now)).toBe(1);
    expect(engine.getAvailableQuantity("var-jacket", now)).toBe(4); // 5 - 1 = 4 (hold does not block)

    // 3. Aged list includes expired hold
    const agedList = engine.getAgedReservations(7 * 24 * 3600 * 1000, now);
    expect(agedList.map((r) => r.id)).toContain("res-hold-1");
  });

  it("verifies DDL view declaration for reservations_view and effective_status", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const schemaSql = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf-8").toLowerCase();
    const migrationSql = fs
      .readFileSync(path.join(root, "supabase/migrations/20261104183000_m2c_effective_status.sql"), "utf-8")
      .toLowerCase();

    expect(migrationSql).toContain("create or replace view public.reservations_view");
    expect(migrationSql).toContain("effective_status");
    expect(migrationSql).toContain("expires_at < now()");
    expect(schemaSql).toContain("create or replace view public.reservations_view");
  });
});
