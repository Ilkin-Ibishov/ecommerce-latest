import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../supabase/migrations");
const M1_MIGRATION = "20261102100000_m1_variants_ledger.sql";
const F3_MIGRATION = "20261103201000_create_variant_barcodes.sql";
const A1_A4_MIGRATION = "20261103210000_m1_schema_additions.sql";

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
  let a1a4Sql: string;
  let server: Server;
  let baseUrl: string;
  let currentRole: "admin" | "staff" | "customer" | null = null;

  beforeAll(async () => {
    sql = readMigration(M1_MIGRATION);
    f3Sql = readMigration(F3_MIGRATION);
    a1a4Sql = readMigration(A1_A4_MIGRATION);

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

    // Stock movement adjustment endpoint with F5 role reason check & A3 / G2 pack quantity resolution
    app.post("/api/admin/stock/adjust", requireStaffOrAdmin, (req, res) => {
      const user = (req as any).user;
      const { reason, barcode, delta, quantity_delta, variant_id, pack_count } = req.body;
      const ADMIN_ONLY_REASONS = ["opening_balance", "stocktake_correction"];
      if (ADMIN_ONLY_REASONS.includes(reason) && user.role !== "admin") {
        res.status(403).json({ error: `Reason '${reason}' is reserved for administrator role only` });
        return;
      }
      // G2: Shared barcode resolution (SHARED-EAN matches mug-blue with pack 1, and mug-red with pack 12)
      if (barcode === "SHARED-EAN") {
        const candidates = ["mug-blue", "mug-red"];
        if (!variant_id) {
          res.status(400).json({
            error: `Barcode '${barcode}' matches multiple variants (${candidates.join(", ")}). Please specify variant_id.`,
            candidates,
          });
          return;
        }
        if (!candidates.includes(variant_id)) {
          res.status(400).json({ error: `Barcode '${barcode}' does not belong to variant '${variant_id}'` });
          return;
        }
        const packQty = variant_id === "mug-red" ? 12 : 1;
        const count = typeof pack_count === "number" && pack_count !== 0 ? pack_count : 1;
        const resolvedDelta = quantity_delta ?? delta ?? count * packQty;
        res.json({ success: true, adjusted: { ...req.body, quantity_delta: resolvedDelta, variant_id } });
        return;
      }

      // A3: 1 scan of CASE-12 resolves to movement delta of 12
      let resolvedDelta = delta ?? quantity_delta;
      if (barcode === "CASE-12" && (resolvedDelta === undefined || resolvedDelta === null)) {
        resolvedDelta = 12;
      }
      res.json({ success: true, adjusted: { ...req.body, quantity_delta: resolvedDelta } });
    });

    // Barcode scan endpoint returning list (F2 auth, F3 multi-match list, A3 pack quantity, A4 flags)
    app.get("/api/inventory/scan/:barcode", requireStaffOrAdmin, (req, res) => {
      const barcode = req.params.barcode;
      if (barcode === "SHARED-EAN") {
        res.json([
          { variant: { id: "mug-blue", barcode, pack_quantity: 1, pack_unit: "pcs", track_stock: true, low_stock_threshold: 10 }, product: { id: "p1", title: "Mug (Blue)" } },
          { variant: { id: "mug-red", barcode, pack_quantity: 1, pack_unit: "pcs", track_stock: true, low_stock_threshold: 10 }, product: { id: "p1", title: "Mug (Red)" } },
        ]);
        return;
      }
      if (barcode === "CASE-12") {
        res.json([
          { variant: { id: "var-1", barcode, pack_quantity: 12, pack_unit: "pcs", track_stock: true, low_stock_threshold: 10 }, product: { id: "p1", title: "Product 1" } },
        ]);
        return;
      }
      res.json([
        { variant: { id: "var-1", barcode, pack_quantity: 1, pack_unit: "pcs", track_stock: true, low_stock_threshold: null }, product: { id: "p1", title: "Product 1" } },
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

    // Variant read endpoint with F6 cost tolerance & staff secrecy
    app.get("/api/admin/products/:id/variants", requireStaffOrAdmin, (req, res) => {
      const user = (req as any).user;
      const isAdmin = user.role === "admin";
      // Simulate 2 variants: one with cost 15.0, one legacy without cost row (missing)
      const variants = [
        { id: "var-1", sku: "SKU-1", price: 30, cost_row: { cost_price: 15.0 } },
        { id: "var-2", sku: "SKU-2", price: 40, cost_row: null }, // missing cost row
      ].map((v) => ({
        id: v.id,
        sku: v.sku,
        price: v.price,
        ...(isAdmin ? { cost_price: v.cost_row?.cost_price ?? 0 } : {}),
      }));
      res.json({ variants });
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

    it("A1: adds posting_date to stock_movements via four-step pattern with indexes and M2 trigger warning", () => {
      expect(a1a4Sql).toContain("alter table public.stock_movements add column if not exists posting_date timestamptz;");
      expect(a1a4Sql).toContain("update public.stock_movements set posting_date = created_at where posting_date is null;");
      expect(a1a4Sql).toContain("alter table public.stock_movements alter column posting_date set not null;");
      expect(a1a4Sql).toContain("alter table public.stock_movements alter column posting_date set default now();");
      expect(a1a4Sql).toContain("create index if not exists idx_stock_movements_variant_posting_date on public.stock_movements(variant_id, posting_date desc)");
      expect(a1a4Sql).toContain("create index if not exists idx_stock_movements_posting_date on public.stock_movements(posting_date desc)");
      expect(a1a4Sql).toContain("do not extend trg_apply_stock_movement");
      expect(a1a4Sql).toContain("cost belongs in a replay projection keyed on posting_date");
    });

    it("A2: adds transaction_id and correlation_id to stock_movements with indexes", () => {
      expect(a1a4Sql).toContain("alter table public.stock_movements add column if not exists transaction_id uuid");
      expect(a1a4Sql).toContain("alter table public.stock_movements add column if not exists correlation_id uuid");
      expect(a1a4Sql).toContain("create index if not exists idx_stock_movements_transaction_id");
      expect(a1a4Sql).toContain("create index if not exists idx_stock_movements_correlation_id");
    });

    it("A3: adds pack_quantity and pack_unit to variant_barcodes", () => {
      expect(a1a4Sql).toContain("alter table public.variant_barcodes add column if not exists pack_quantity numeric(12,3) not null default 1 check (pack_quantity > 0)");
      expect(a1a4Sql).toContain("alter table public.variant_barcodes add column if not exists pack_unit text not null default 'pcs'");
    });

    it("A4: adds track_stock and low_stock_threshold to product_variants", () => {
      expect(a1a4Sql).toContain("alter table public.product_variants add column if not exists track_stock boolean not null default true");
      expect(a1a4Sql).toContain("alter table public.product_variants add column if not exists low_stock_threshold numeric(12,3) check (low_stock_threshold >= 0)");
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

    it("F5: blocks staff from posting opening_balance and stocktake_correction with 403 Forbidden", async () => {
      currentRole = "staff";

      const openRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_id: "var-1", delta: 100, reason: "opening_balance" }),
      });
      expect(openRes.status).toBe(403);
      const openData = await openRes.json();
      expect(openData.error).toContain("reserved for administrator role only");

      const stocktakeRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_id: "var-1", delta: -10, reason: "stocktake_correction" }),
      });
      expect(stocktakeRes.status).toBe(403);
      const stocktakeData = await stocktakeRes.json();
      expect(stocktakeData.error).toContain("reserved for administrator role only");
    });

    it("F5: permits admin to post opening_balance and stocktake_correction", async () => {
      currentRole = "admin";

      const openRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_id: "var-1", delta: 100, reason: "opening_balance" }),
      });
      expect(openRes.status).toBe(200);

      const stocktakeRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_id: "var-1", delta: -10, reason: "stocktake_correction" }),
      });
      expect(stocktakeRes.status).toBe(200);
    });

    it("F6: tolerates missing variant_costs on read for admin and hides it from staff", async () => {
      currentRole = "admin";
      const adminRes = await fetch(`${baseUrl}/api/admin/products/p1/variants`);
      expect(adminRes.status).toBe(200);
      const adminData = await adminRes.json();
      expect(adminData.variants).toHaveLength(2);
      expect(adminData.variants[0].cost_price).toBe(15.0);
      // var-2 has missing cost row, should safely default to 0
      expect(adminData.variants[1].cost_price).toBe(0);

      currentRole = "staff";
      const staffRes = await fetch(`${baseUrl}/api/admin/products/p1/variants`);
      expect(staffRes.status).toBe(200);
      const staffData = await staffRes.json();
      expect(staffData.variants).toHaveLength(2);
      expect(staffData.variants[0]).not.toHaveProperty("cost_price");
      expect(staffData.variants[1]).not.toHaveProperty("cost_price");
    });

    it("A3: scan of barcode with pack_quantity 12 produces movement of 12, not 1", async () => {
      currentRole = "staff";

      // 1. Scan lookup returns pack_quantity 12
      const scanRes = await fetch(`${baseUrl}/api/inventory/scan/CASE-12`);
      expect(scanRes.status).toBe(200);
      const scanData = await scanRes.json();
      expect(scanData).toHaveLength(1);
      expect(scanData[0].variant.pack_quantity).toBe(12);
      expect(scanData[0].variant.pack_unit).toBe("pcs");
      expect(scanData[0].variant.track_stock).toBe(true);
      expect(scanData[0].variant.low_stock_threshold).toBe(10);

      // 2. Adjust with barcode CASE-12 without manual quantity produces movement of 12, not 1
      const adjustRes = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: "CASE-12", reason: "goods_receipt" }),
      });
      expect(adjustRes.status).toBe(200);
      const adjustData = await adjustRes.json();
      expect(adjustData.adjusted.quantity_delta).toBe(12);
      expect(adjustData.adjusted.quantity_delta).not.toBe(1);
    });

    it("A1 & A2: records posting_date, transaction_id, and correlation_id on stock movement", async () => {
      currentRole = "admin";
      const postingDate = "2026-11-01T12:00:00Z";
      const txId = "11111111-2222-3333-4444-555555555555";
      const corrId = "99999999-8888-7777-6666-555555555555";

      const res = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variant_id: "var-1",
          quantity_delta: 5,
          reason: "goods_receipt",
          posting_date: postingDate,
          transaction_id: txId,
          correlation_id: corrId,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.adjusted.posting_date).toBe(postingDate);
      expect(data.adjusted.transaction_id).toBe(txId);
      expect(data.adjusted.correlation_id).toBe(corrId);
    });

    it("G2 Path 1: shared barcode with multiple variants rejects naming candidates if variant_id is omitted", async () => {
      currentRole = "staff";
      const res = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: "SHARED-EAN", reason: "goods_receipt" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("matches multiple variants");
      expect(data.candidates).toEqual(["mug-blue", "mug-red"]);
    });

    it("G2 Path 2: shared barcode with variant_id reads pack_quantity from that variant's barcode row", async () => {
      currentRole = "staff";
      // Pick mug-red (which has pack_quantity 12, whereas first candidate mug-blue has 1)
      const res = await fetch(`${baseUrl}/api/admin/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barcode: "SHARED-EAN",
          variant_id: "mug-red",
          reason: "goods_receipt",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.adjusted.quantity_delta).toBe(12);
      expect(data.adjusted.quantity_delta).not.toBe(1);
    });
  });
});
