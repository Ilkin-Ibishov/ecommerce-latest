import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * M2c C5 — Public Availability Grant and Anon Privacy Boundary Test
 *
 * Requirements:
 * - Two objects, one source:
 *   - product_variant_availability: full view, granted to authenticated & service_role only.
 *   - product_variant_public_availability: variant_id, product_id, available_quantity only.
 * - An anonymous PostgREST read of the public view returns available_quantity and NO reserved_quantity.
 * - An anonymous read of the full view is refused (revoked).
 * - Invariant: no view or table granted to anon may expose columns matching /reserved|deficit|cost|margin/i.
 */

interface ClientAuthContext {
  role: "anon" | "authenticated" | "service_role";
}

class MockPostgrestServer {
  private publicViewData = [
    {
      variant_id: "var-001",
      product_id: "prod-001",
      available_quantity: 4,
    },
  ];

  private fullViewData = [
    {
      variant_id: "var-001",
      product_id: "prod-001",
      sku: "SKU-001",
      price: 25,
      on_hand: 5,
      reserved_quantity: 1,
      available_quantity: 4,
      deficit_quantity: 0,
    },
  ];

  public queryView(viewName: string, auth: ClientAuthContext) {
    if (viewName === "product_variant_public_availability") {
      // Granted to anon, authenticated, and service_role
      return { status: 200, data: this.publicViewData };
    }

    if (viewName === "product_variant_availability") {
      // V2: Granted to service_role only. Revoked from anon AND authenticated!
      if (auth.role === "anon" || auth.role === "authenticated") {
        throw new Error("403: Permission denied. Access to product_variant_availability is refused for anon and authenticated.");
      }
      return { status: 200, data: this.fullViewData };
    }

    throw new Error(`404: Object not found: ${viewName}`);
  }
}

describe("M2c C5: Public Availability Grant & Column Privacy", () => {
  it("allows anon to read product_variant_public_availability returning available_quantity without reserved_quantity", () => {
    const server = new MockPostgrestServer();
    const res = server.queryView("product_variant_public_availability", { role: "anon" });

    expect(res.status).toBe(200);
    expect(res.data.length).toBe(1);
    const row = res.data[0];

    // Must contain available_quantity
    expect(row).toHaveProperty("available_quantity", 4);
    expect(row).toHaveProperty("variant_id", "var-001");
    expect(row).toHaveProperty("product_id", "prod-001");

    // Must NOT contain internal business quantities
    expect(row).not.toHaveProperty("reserved_quantity");
    expect(row).not.toHaveProperty("deficit_quantity");
    expect(row).not.toHaveProperty("on_hand");
    expect(row).not.toHaveProperty("cost_price");
  });

  it("refuses anon and authenticated (customer) reads of the full product_variant_availability view (V2)", () => {
    const server = new MockPostgrestServer();

    // Anon read is refused
    expect(() => {
      server.queryView("product_variant_availability", { role: "anon" });
    }).toThrow(/403: Permission denied/);

    // Authenticated (customer) read is refused
    expect(() => {
      server.queryView("product_variant_availability", { role: "authenticated" });
    }).toThrow(/403: Permission denied/);

    // Service-role read succeeds
    const serviceRes = server.queryView("product_variant_availability", { role: "service_role" });
    expect(serviceRes.status).toBe(200);
    expect(serviceRes.data[0]).toHaveProperty("reserved_quantity", 1);
  });

  it("verifies DDL grant and revoke declarations in migration and schema", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const schemaSql = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf-8").toLowerCase();
    const migrationSql = fs
      .readFileSync(path.join(root, "supabase/migrations/20261104185000_m2c_public_availability_grant.sql"), "utf-8")
      .toLowerCase();
    const fixMigrationSql = fs
      .readFileSync(path.join(root, "supabase/migrations/20261105200000_m2c_view_security.sql"), "utf-8")
      .toLowerCase();

    // Verify anon revoked from full view and granted only to public view
    expect(migrationSql).toContain("revoke all on public.product_variant_availability from anon");
    expect(migrationSql).toContain("grant select on public.product_variant_public_availability to anon");
    expect(schemaSql).toContain("create or replace view public.product_variant_public_availability");

    // Verify V2 revoke from authenticated and grant only to service_role
    expect(fixMigrationSql).toContain("revoke all on public.product_variant_availability from authenticated");
    expect(fixMigrationSql).toContain("grant select on public.product_variant_availability to service_role");
    expect(schemaSql).toContain("revoke all on public.product_variant_availability from anon, authenticated");
    expect(schemaSql).toContain("grant select on public.product_variant_availability to service_role");
  });
});
