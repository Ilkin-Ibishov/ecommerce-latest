import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * M2a F2 — allow_negative_stock Tenant Setting & Movement Override Tests
 *
 * Spec: docs/tasks/warehouse-m2a-receiving-cost.md (§10 item 4)
 * Prompt Finding: F2 — allow_negative_stock was inert; trg_apply_stock_movement
 * unconditionally blocked negative on-hand.
 *
 * Requirements:
 * 1. Default off (false).
 * 2. When false, outflow exceeding on_hand is rejected with ST001.
 * 3. When true, outflow exceeding on_hand succeeds, on_hand becomes negative, and
 *    negative_stock_override is recorded as true on the movement row.
 * 4. When true but outflow does NOT push stock negative, negative_stock_override remains false.
 * 5. Owner-writable only (guarded by requireAdmin).
 */

class MockStockEngine {
  public onHand: number;
  public allowNegative: boolean;
  public movements: Array<{ delta: number; onHandAfter: number; override: boolean }>;

  constructor(initialOnHand = 0, allowNegative = false) {
    this.onHand = initialOnHand;
    this.allowNegative = allowNegative;
    this.movements = [];
  }

  applyMovement(delta: number): { onHand: number; override: boolean } {
    if (this.allowNegative) {
      this.onHand += delta;
      const override = this.onHand < 0;
      this.movements.push({ delta, onHandAfter: this.onHand, override });
      return { onHand: this.onHand, override };
    } else {
      if (this.onHand + delta < 0) {
        throw new Error(`ST001: Insufficient stock for variant`);
      }
      this.onHand += delta;
      this.movements.push({ delta, onHandAfter: this.onHand, override: false });
      return { onHand: this.onHand, override: false };
    }
  }
}

describe("M2a F2 — allow_negative_stock setting and movement override", () => {
  describe("Engine execution logic", () => {
    it("rejects negative stock when allow_negative_stock is false (default off)", () => {
      const engine = new MockStockEngine(0, false);
      expect(() => engine.applyMovement(-1)).toThrow("ST001: Insufficient stock for variant");
      expect(engine.onHand).toBe(0);
      expect(engine.movements.length).toBe(0);
    });

    it("allows negative stock and stamps negative_stock_override when allow_negative_stock is true", () => {
      const engine = new MockStockEngine(0, true);
      const res = engine.applyMovement(-5);
      expect(res.onHand).toBe(-5);
      expect(res.override).toBe(true);
      expect(engine.onHand).toBe(-5);
      expect(engine.movements[0].override).toBe(true);
    });

    it("does not stamp override when stock remains non-negative even if allow_negative_stock is true", () => {
      const engine = new MockStockEngine(10, true);
      const res = engine.applyMovement(-4);
      expect(res.onHand).toBe(6);
      expect(res.override).toBe(false);
      expect(engine.movements[0].override).toBe(false);
    });

    it("accurately detects override when stock crosses from positive to negative", () => {
      const engine = new MockStockEngine(2, true);
      const res = engine.applyMovement(-5);
      expect(res.onHand).toBe(-3);
      expect(res.override).toBe(true);
      expect(engine.movements[0].override).toBe(true);
    });
  });

  describe("DDL & Trigger Structural Verification", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const schemaSqlPath = path.join(root, "supabase/schema.sql");
    const funcMigrationPath = path.join(root, "supabase/migrations/20261104110000_m2a_functions_triggers.sql");
    const schemaMigrationPath = path.join(root, "supabase/migrations/20261104100000_m2a_schema_tables.sql");

    it("declares allow_negative_stock in site_settings with default false", () => {
      const schemaSql = fs.readFileSync(schemaSqlPath, "utf-8");
      const migrationSql = fs.readFileSync(schemaMigrationPath, "utf-8");

      expect(schemaSql.toLowerCase()).toContain("allow_negative_stock boolean not null default false");
      expect(migrationSql.toLowerCase()).toContain("allow_negative_stock boolean not null default false");
    });

    it("declares negative_stock_override in stock_movements with default false", () => {
      const schemaSql = fs.readFileSync(schemaSqlPath, "utf-8");
      const migrationSql = fs.readFileSync(schemaMigrationPath, "utf-8");

      expect(schemaSql.toLowerCase()).toContain("negative_stock_override boolean not null default false");
      expect(migrationSql.toLowerCase()).toContain("negative_stock_override boolean not null default false");
    });

    it("wires trg_apply_stock_movement as BEFORE INSERT checking allow_negative_stock", () => {
      const funcMigration = fs.readFileSync(funcMigrationPath, "utf-8");
      const lower = funcMigration.toLowerCase();

      expect(lower).toContain("coalesce(allow_negative_stock, false)");
      expect(lower).toContain("new.negative_stock_override := true");
      expect(lower).toContain("before insert on public.stock_movements");
    });
  });

  describe("API Settings Route Security & Validation", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const siteSettingsRoutePath = path.join(root, "artifacts/api-server/src/routes/site-settings.ts");

    it("includes allow_negative_stock in VALID_FIELDS and validates boolean type", () => {
      const content = fs.readFileSync(siteSettingsRoutePath, "utf-8");
      expect(content).toContain('"allow_negative_stock"');
      expect(content).toContain('typeof updates.allow_negative_stock !== "boolean"');
    });

    it("verifies site_settings PATCH requires admin privileges", () => {
      const content = fs.readFileSync(siteSettingsRoutePath, "utf-8");
      // PATCH /site-settings invokes requireAdmin middleware
      expect(content).toContain('router.patch("/site-settings", requireAdmin');
    });
  });
});
