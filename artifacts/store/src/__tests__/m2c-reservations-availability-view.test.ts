import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * M2c C4 — Single-Source Availability and Deficit Exposure Test
 *
 * Requirements:
 * - product_variant_availability exposes three exact numbers:
 *   1. reserved_quantity: sum of active, unexpired reservations
 *   2. available_quantity: GREATEST(0, on_hand - reserved_quantity)
 *   3. deficit_quantity: GREATEST(0, reserved_quantity - on_hand)
 * - Admin inventory reads all three; no UI or route recomputes them.
 * - In a deficit (on_hand < reserved_quantity), available is 0 and deficit exposes the difference.
 */

interface MockVariant {
  id: string;
  productId: string;
  sku: string;
  price: number;
  onHand: number;
}

interface MockReservation {
  id: string;
  variantId: string;
  quantity: number;
  status: "active" | "fulfilled" | "released" | "expired";
  expiresAt: number | null;
}

class MockAvailabilityEngine {
  public variants = new Map<string, MockVariant>();
  public reservations: MockReservation[] = [];

  public setVariant(v: MockVariant) {
    this.variants.set(v.id, { ...v });
  }

  public addReservation(r: MockReservation) {
    this.reservations.push({ ...r });
  }

  /**
   * Simulates product_variant_availability view SQL logic.
   */
  public getAvailabilityView(nowMs: number = Date.now()) {
    const results = [];
    for (const v of this.variants.values()) {
      const activeReserved = this.reservations
        .filter((r) => r.variantId === v.id && r.status === "active" && (r.expiresAt === null || r.expiresAt > nowMs))
        .reduce((sum, r) => sum + r.quantity, 0);

      const availableQuantity = Math.max(0, v.onHand - activeReserved);
      const deficitQuantity = Math.max(0, activeReserved - v.onHand);

      results.push({
        variantId: v.id,
        productId: v.productId,
        sku: v.sku,
        price: v.price,
        onHand: v.onHand,
        reservedQuantity: activeReserved,
        availableQuantity,
        deficitQuantity,
      });
    }
    return results;
  }
}

describe("M2c C4: product_variant_availability & Deficit Quantity", () => {
  it("calculates reserved, available, and deficit quantities accurately in normal state", () => {
    const engine = new MockAvailabilityEngine();
    engine.setVariant({
      id: "v-normal",
      productId: "p1",
      sku: "SKU-NORM",
      price: 100,
      onHand: 5,
    });

    engine.addReservation({
      id: "res-1",
      variantId: "v-normal",
      quantity: 2,
      status: "active",
      expiresAt: null,
    });

    const rows = engine.getAvailabilityView();
    const row = rows.find((r) => r.variantId === "v-normal")!;

    expect(row.onHand).toBe(5);
    expect(row.reservedQuantity).toBe(2);
    expect(row.availableQuantity).toBe(3); // 5 - 2 = 3
    expect(row.deficitQuantity).toBe(0); // 2 - 5 <= 0 => 0
  });

  it("exposes deficit_quantity when physical count drops below reserved promises (deficit state)", () => {
    const engine = new MockAvailabilityEngine();
    // E.g. stocktake or shrinkage discovery: on_hand is 1, but 3 units were promised to deposit customers
    engine.setVariant({
      id: "v-deficit",
      productId: "p2",
      sku: "SKU-DEF",
      price: 150,
      onHand: 1,
    });

    engine.addReservation({
      id: "res-def-1",
      variantId: "v-deficit",
      quantity: 3,
      status: "active",
      expiresAt: null,
    });

    const rows = engine.getAvailabilityView();
    const row = rows.find((r) => r.variantId === "v-deficit")!;

    expect(row.onHand).toBe(1);
    expect(row.reservedQuantity).toBe(3);
    expect(row.availableQuantity).toBe(0); // Clamped: GREATEST(0, 1 - 3) = 0
    expect(row.deficitQuantity).toBe(2); // GREATEST(0, 3 - 1) = 2
  });

  it("verifies DDL view declaration for product_variant_availability", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const schemaSql = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf-8").toLowerCase();
    const migrationSql = fs
      .readFileSync(path.join(root, "supabase/migrations/20261104184000_m2c_availability_view.sql"), "utf-8")
      .toLowerCase();

    expect(migrationSql).toContain("create or replace view public.product_variant_availability");
    expect(migrationSql).toContain("reserved_quantity");
    expect(migrationSql).toContain("available_quantity");
    expect(migrationSql).toContain("deficit_quantity");
    expect(migrationSql).toContain("greatest(0, coalesce(r.active_reserved, 0) - pv.on_hand)");
    expect(schemaSql).toContain("create or replace view public.product_variant_availability");
  });
});
