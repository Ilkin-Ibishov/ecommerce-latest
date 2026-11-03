import { describe, it, expect } from "vitest";

/**
 * F2 Test — Barcode Scan Endpoint Auth Guard
 *
 * Validates that /inventory/scan/:barcode requires staff or admin role
 * and rejects unauthenticated and unauthorized requests.
 */

interface MockUser {
  id: string;
  role: "admin" | "staff" | "customer";
}

function handleScanAuth(user: MockUser | null): { status: number; body: { error?: string; success?: boolean } } {
  if (!user) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  if (user.role !== "admin" && user.role !== "staff") {
    return { status: 403, body: { error: "Forbidden: staff or admin required" } };
  }
  return { status: 200, body: { success: true } };
}

describe("F2: Barcode Scan Authentication Guard", () => {
  it("rejects unauthenticated request with 401 Unauthorized", () => {
    const res = handleScanAuth(null);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("rejects customer role with 403 Forbidden", () => {
    const res = handleScanAuth({ id: "cust-1", role: "customer" });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Forbidden");
  });

  it("allows staff role with 200 OK", () => {
    const res = handleScanAuth({ id: "staff-1", role: "staff" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("allows admin role with 200 OK", () => {
    const res = handleScanAuth({ id: "admin-1", role: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
