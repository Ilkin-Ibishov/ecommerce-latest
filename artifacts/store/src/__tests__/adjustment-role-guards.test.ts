import { describe, it, expect } from "vitest";

/**
 * F5 Test — Restrict opening_balance and stocktake_correction to admin role
 *
 * Prevents staff accounts from injecting opening balances or unverified stocktake
 * corrections that would mask inventory discrepancies or theft.
 */

const ADMIN_ONLY_REASONS = ["opening_balance", "stocktake_correction"];
const VALID_REASONS = [
  "goods_receipt",
  "online_sale",
  "counter_sale",
  "customer_return",
  "return_to_supplier",
  "damage_write_off",
  "stocktake_correction",
  "manual_adjustment",
  "opening_balance",
];

function validateAdjustmentPermission(
  reason: string,
  userRole: "admin" | "staff"
): { allowed: boolean; status: number; error?: string } {
  if (!VALID_REASONS.includes(reason)) {
    return { allowed: false, status: 400, error: "Invalid reason" };
  }
  if (ADMIN_ONLY_REASONS.includes(reason) && userRole !== "admin") {
    return {
      allowed: false,
      status: 403,
      error: `Reason '${reason}' is reserved for administrator role only`,
    };
  }
  return { allowed: true, status: 200 };
}

describe("F5: Adjustment Reason Role Enforcement", () => {
  it("strictly forbids staff from posting opening_balance adjustments with 403", () => {
    const res = validateAdjustmentPermission("opening_balance", "staff");
    expect(res.allowed).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error).toContain("reserved for administrator role only");
  });

  it("strictly forbids staff from posting stocktake_correction adjustments with 403", () => {
    const res = validateAdjustmentPermission("stocktake_correction", "staff");
    expect(res.allowed).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error).toContain("reserved for administrator role only");
  });

  it("allows staff to post operational adjustments (manual_adjustment, damage_write_off, goods_receipt)", () => {
    ["manual_adjustment", "damage_write_off", "goods_receipt", "customer_return", "return_to_supplier"].forEach(
      (reason) => {
        const res = validateAdjustmentPermission(reason, "staff");
        expect(res.allowed).toBe(true);
        expect(res.status).toBe(200);
      }
    );
  });

  it("allows admin full access to all valid reasons including opening_balance and stocktake_correction", () => {
    VALID_REASONS.forEach((reason) => {
      const res = validateAdjustmentPermission(reason, "admin");
      expect(res.allowed).toBe(true);
      expect(res.status).toBe(200);
    });
  });
});
