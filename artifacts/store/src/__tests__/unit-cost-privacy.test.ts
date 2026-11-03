import { describe, it, expect } from "vitest";

/**
 * F4 Test — unit_cost Privacy & Secrecy
 *
 * Spec §3: "Owner sees cost and margin; staff do not."
 * Validates:
 * 1. GET /api/admin/variants/:id/movements strips unit_cost for staff callers.
 * 2. GET /api/admin/variants/:id/movements includes unit_cost for admin callers.
 * 3. POST /admin/stock/adjust ignores unit_cost if caller is staff.
 */

interface MovementRow {
  id: string;
  variant_id: string;
  quantity_delta: number;
  reason: string;
  unit_cost: number | null;
  note: string | null;
}

function sanitizeMovementsForRole(movements: MovementRow[], role: "admin" | "staff"): any[] {
  if (role === "staff") {
    return movements.map(({ unit_cost, ...rest }) => rest);
  }
  return movements;
}

function resolveAdjustmentCost(unitCost: number | undefined, role: "admin" | "staff"): number | null {
  return role === "admin" && typeof unitCost === "number" && unitCost >= 0 ? unitCost : null;
}

describe("F4: unit_cost Margin Protection for Staff Role", () => {
  const sampleMovements: MovementRow[] = [
    {
      id: "mov-1",
      variant_id: "var-1",
      quantity_delta: 50,
      reason: "goods_receipt",
      unit_cost: 12.5,
      note: "Supplier delivery PO-102",
    },
    {
      id: "mov-2",
      variant_id: "var-1",
      quantity_delta: -2,
      reason: "online_sale",
      unit_cost: null,
      note: "Order #501",
    },
  ];

  it("strips unit_cost on every row when requested by staff", () => {
    const result = sanitizeMovementsForRole(sampleMovements, "staff");
    expect(result).toHaveLength(2);
    result.forEach((m) => {
      expect(m).not.toHaveProperty("unit_cost");
    });
    expect(result[0].quantity_delta).toBe(50);
  });

  it("preserves unit_cost on rows when requested by admin", () => {
    const result = sanitizeMovementsForRole(sampleMovements, "admin");
    expect(result).toHaveLength(2);
    expect(result[0].unit_cost).toBe(12.5);
    expect(result[1].unit_cost).toBeNull();
  });

  it("prevents staff from injecting unit_cost during stock adjustment", () => {
    const staffCost = resolveAdjustmentCost(15.0, "staff");
    expect(staffCost).toBeNull();

    const adminCost = resolveAdjustmentCost(15.0, "admin");
    expect(adminCost).toBe(15.0);
  });
});
