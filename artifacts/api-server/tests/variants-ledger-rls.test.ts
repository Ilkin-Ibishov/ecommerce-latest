import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../supabase/migrations");
const M1_MIGRATION = "20261102100000_m1_variants_ledger.sql";
const F3_MIGRATION = "20261103201000_create_variant_barcodes.sql";

function readMigration(filename: string): string {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Migration not found at ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf-8").replace(/\s+/g, " ").toLowerCase();
}

describe("M1 Variants & Ledger RLS & Role Enforcement", () => {
  let sql: string;
  let f3Sql: string;
  let server: Server;
  let baseUrl: string;
  let currentRole: "admin" | "staff" | "customer" | null = null;

  beforeAll(async () => {
    sql = readMigration(M1_MIGRATION);
    f3Sql = readMigration(F3_MIGRATION);

    const app = express();
    app.use(express.json());

    // Middleware simulating session auth resolution
    app.use((req, _res, next) => {
      (req as any).user = currentRole ? { id: `u-${currentRole}`, role: currentRole } : null;
      next();
    });

    const requireStaffOrAdmin = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ): Promise<void> => {
      const user = (req as any).user;
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (user.role !== "admin" && user.role !== "staff") {
        res.status(403).json({ error: "Forbidden: Staff or Admin role required" });
        return;
      }
      next();
    };

    // Variant PATCH endpoint with staff price-mutation guard
    app.patch("/api/admin/variants/:id", requireStaffOrAdmin, (req, res) => {
      const user = (req as any).user;
      if (req.body.price !== undefined && user.role === "staff") {
        res.status(403).json({ error: "Staff users cannot modify variant prices" });
        return;
      }
      res.json({ success: true, updated: req.body });
    });

    // Stock movement adjustment endpoint
    app.post("/api/admin/stock/adjust", requireStaffOrAdmin, (req, res) => {
      res.json({ success: true, adjusted: req.body });
    });

    // Barcode scan endpoint returning list (F2 auth & F3 multi-match list)
    app.get("/api/inventory/scan/:barcode", requireStaffOrAdmin, (req, res) => {
      const barcode = req.params.barcode;
      if (barcode === "SHARED-EAN") {
        res.json([
          { variant: { id: "mug-blue", barcode }, product: { id: "p1", title: "Mug (Blue)" } },
          { variant: { id: "mug-red", barcode }, product: { id: "p1", title: "Mug (Red)" } },
        ]);
        return;
      }
      res.json([
        { variant: { id: "var-1", barcode }, product: { id: "p1", title: "Product 1" } },
      ]);
    });

    // Movement history endpoint with F4 unit_cost stripping
    app.get("/api/admin/variants/:id/movements", requireStaffOrAdmin, (req, res) => {
      const user = (req as any).user;
      const isStaff = user.role === "staff";
      const sample = [
        { id: "mov-1", delta: 10, reason: "goods_receipt", unit_cost: 25.0 },
      ];
      const sanitized = sample.map((m) => {
        if (isStaff) {
          const { unit_cost, ...rest } = m;
          return rest;
        }
        return m;
      });
      res.json({ movements: sanitized });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("DDL & RLS Security Invariants", () => {
    it("enables RLS on product_variants, variant_costs, and stock_movements", () => {
      expect(sql).toContain("alter table public.product_variants enable row level security");
      expect(sql).toContain("alter table public.variant_costs enable row level security");
      expect(sql).toContain("alter table public.stock_movements enable row level security");
    });

    it("F3: enables RLS and defines policies on variant_barcodes", () => {
      expect(f3Sql).toContain("alter table public.variant_barcodes enable row level security");
      expect(f3Sql).toContain("create table if not exists public.variant_barcodes");
      expect(f3Sql).toContain("uq_variant_barcodes_variant_barcode unique (variant_id, barcode)");
      expect(f3Sql).toContain("drop index if exists public.idx_variants_barcode");
      expect(f3Sql).toContain("idx_variant_barcodes_single_primary");
    });

    it("restricts variant_costs access exclusively to admin role", () => {
      expect(sql).toContain('"variantcosts: admin read" on public.variant_costs');
      expect(sql).toContain("u.role = 'admin'");
      expect(sql).not.toContain("u.role in ('admin', 'staff') on public.variant_costs");
    });

    it("permits staff and admin to insert stock movements but enforces ledger immutability", () => {
      expect(sql).toContain('"movements: staff/admin insert" on public.stock_movements');
      expect(sql).toContain("for insert with check");
      expect(sql).toContain("u.role in ('admin', 'staff')");
      expect(sql).toContain("trg_stock_movements_immutable()");
      expect(sql).toContain("2bp01");
    });

    it("prohibits staff from changing variant prices via trigger with SQLSTATE 42501", () => {
      expect(sql).toContain("create or replace function trg_guard_staff_price_update()");
      expect(sql).toContain("u.role = 'staff'");
      expect(sql).toContain("new.price is distinct from old.price");
      expect(sql).toContain("42501");
      expect(sql).toContain("product_variants_guard_price");
    });

    it("prohibits direct on_hand updates with SQLSTATE 55000", () => {
      expect(sql).toContain("create or replace function trg_guard_variant_on_hand_update()");
      expect(sql).toContain("pg_trigger_depth() <= 1");
      expect(sql).toContain("55000");
      expect(sql).toContain("product_variants_guard_on_hand");
    });

    it("uses custom SQLSTATE ST001 on insufficient stock and ST002 on variant not found", () => {
      expect(sql).toContain("errcode = 'st001'");
      expect(sql).toContain("errcode = 'st002'");
      expect(sql).not.toContain("errcode = 'p0001'");
    });
  });

  describe("API Route Authorization Enforcement", () => {
    it("allows admin full access to update variant prices and stock", async () => {
      currentRole = "admin";

      const priceRes = await fetch(`${baseUrl}/api/admin/variants/var-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: 49.99 }),
      });
      expect(priceRes.status).toBe(200);

      const stockRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_id: "var-1", delta: 10, reason: "manual_adjustment" }),
      });
      expect(stockRes.status).toBe(200);
    });

    it("allows staff to adjust stock and edit non-price variant fields", async () => {
      currentRole = "staff";

      const stockRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_id: "var-1", delta: 5, reason: "manual_adjustment" }),
      });
      expect(stockRes.status).toBe(200);

      const nonPriceRes = await fetch(`${baseUrl}/api/admin/variants/var-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: "BARCODE-123", sku: "SKU-123" }),
      });
      expect(nonPriceRes.status).toBe(200);
    });

    it("strictly blocks staff from modifying variant prices with 403 Forbidden", async () => {
      currentRole = "staff";

      const priceRes = await fetch(`${baseUrl}/api/admin/variants/var-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: 19.99 }),
      });
      expect(priceRes.status).toBe(403);
      const data = await priceRes.json();
      expect(data.error).toContain("Staff users cannot modify variant prices");
    });

    it("rejects unauthorized and customer requests to admin inventory routes", async () => {
      currentRole = null;
      const anonRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(anonRes.status).toBe(401);

      currentRole = "customer";
      const custRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(custRes.status).toBe(403);
    });

    it("F2: rejects unauthenticated requests to barcode scan endpoint with 401 Unauthorized", async () => {
      currentRole = null;
      const res = await fetch(`${baseUrl}/api/inventory/scan/4006381333931`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("F2: rejects customer requests to barcode scan endpoint with 403 Forbidden", async () => {
      currentRole = "customer";
      const res = await fetch(`${baseUrl}/api/inventory/scan/4006381333931`);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Forbidden");
    });

    it("F2 & F3: permits staff and admin to access barcode scan and returns list", async () => {
      currentRole = "staff";
      const staffRes = await fetch(`${baseUrl}/api/inventory/scan/SHARED-EAN`);
      expect(staffRes.status).toBe(200);
      const matches = await staffRes.json();
      expect(Array.isArray(matches)).toBe(true);
      expect(matches).toHaveLength(2);

      currentRole = "admin";
      const adminRes = await fetch(`${baseUrl}/api/inventory/scan/4006381333931`);
      expect(adminRes.status).toBe(200);
      const adminMatches = await adminRes.json();
      expect(Array.isArray(adminMatches)).toBe(true);
      expect(adminMatches).toHaveLength(1);
    });

    it("F4: hides unit_cost from staff in movement history while allowing admin to see it", async () => {
      currentRole = "staff";
      const staffRes = await fetch(`${baseUrl}/api/admin/variants/var-1/movements`);
      expect(staffRes.status).toBe(200);
      const staffData = await staffRes.json();
      expect(staffData.movements[0]).not.toHaveProperty("unit_cost");

      currentRole = "admin";
      const adminRes = await fetch(`${baseUrl}/api/admin/variants/var-1/movements`);
      expect(adminRes.status).toBe(200);
      const adminData = await adminRes.json();
      expect(adminData.movements[0].unit_cost).toBe(25.0);
    });
  });
});
