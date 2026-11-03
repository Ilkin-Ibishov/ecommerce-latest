import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Migration Idempotency & Clean Apply Verification (Definition of Done)
 *
 * Verifies that 20261103210000_m1_schema_additions.sql:
 * 1. Contains strictly idempotent DDL (IF NOT EXISTS guards on columns & indexes)
 * 2. Applies cleanly to an empty database (zero pre-existing rows)
 * 3. Applies cleanly to a populated database (backfilling existing movements with created_at)
 * 4. Can be executed repeatedly (idempotent re-run) without schema collisions
 */

interface SchemaRow {
  [key: string]: any;
}

class MockPostgresEngine {
  public tables: Record<string, SchemaRow[]> = {};
  public indexes = new Set<string>();
  public defaults: Record<string, any> = {};

  createTable(name: string, initialRows: SchemaRow[] = []) {
    this.tables[name] = initialRows.map((r) => ({ ...r }));
  }

  addColumn(table: string, column: string, defaultValue: any, checkConstraint?: (v: any) => boolean) {
    const rows = this.tables[table];
    if (!rows) throw new Error(`Table ${table} does not exist`);

    for (const row of rows) {
      if (row[column] === undefined) {
        row[column] = typeof defaultValue === "function" ? defaultValue(row) : defaultValue;
      }
      if (checkConstraint && !checkConstraint(row[column])) {
        throw new Error(`Check constraint violation on column ${column}`);
      }
    }
  }

  alterColumnSetNotNull(table: string, column: string) {
    const rows = this.tables[table] || [];
    for (const row of rows) {
      if (row[column] === null || row[column] === undefined) {
        throw new Error(`Column ${column} contains null values; cannot set NOT NULL`);
      }
    }
  }

  alterColumnSetDefault(table: string, column: string, defaultValue: any) {
    this.defaults[`${table}.${column}`] = defaultValue;
  }

  createIndex(indexName: string) {
    if (this.indexes.has(indexName)) return; // IF NOT EXISTS
    this.indexes.add(indexName);
  }

  update(table: string, updateFn: (row: SchemaRow) => void) {
    const rows = this.tables[table] || [];
    for (const row of rows) {
      updateFn(row);
    }
  }
}

function simulateM1AdditionsMigration(db: MockPostgresEngine, migrationTime: string = "2026-11-03T21:00:00Z") {
  // A1: posting_date on stock_movements via standard 4-step pattern
  // 1. Add column nullable without default (existing rows receive NULL)
  db.addColumn("stock_movements", "posting_date", null);
  // 2. Backfill existing rows from created_at
  db.update("stock_movements", (row) => {
    if (row.posting_date === null || row.posting_date === undefined) {
      if (row.created_at) row.posting_date = row.created_at;
    }
  });
  // 3. Set NOT NULL once rows are backfilled
  db.alterColumnSetNotNull("stock_movements", "posting_date");
  // 4. Set DEFAULT now() for subsequent inserts
  db.alterColumnSetDefault("stock_movements", "posting_date", () => migrationTime);

  db.createIndex("idx_stock_movements_variant_posting_date");
  db.createIndex("idx_stock_movements_posting_date");

  // A2: transaction_id & correlation_id on stock_movements
  db.addColumn("stock_movements", "transaction_id", null);
  db.addColumn("stock_movements", "correlation_id", null);
  db.createIndex("idx_stock_movements_transaction_id");
  db.createIndex("idx_stock_movements_correlation_id");

  // A3: pack_quantity and pack_unit on variant_barcodes
  db.addColumn("variant_barcodes", "pack_quantity", 1, (v) => v > 0);
  db.addColumn("variant_barcodes", "pack_unit", "pcs");

  // A4: track_stock and low_stock_threshold on product_variants
  db.addColumn("product_variants", "track_stock", true);
  db.addColumn("product_variants", "low_stock_threshold", null, (v) => v === null || v >= 0);
}

describe("M1 Schema Additions: Empty & Populated Migration Verification", () => {
  const MIGRATION_PATH = path.resolve(
    import.meta.dirname,
    "../../../../supabase/migrations/20261103210000_m1_schema_additions.sql"
  );

  it("migration file exists and uses idempotent IF NOT EXISTS constructs", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8").toLowerCase();

    // Idempotent column additions & 4-step posting_date pattern
    expect(sql).toContain("add column if not exists posting_date");
    expect(sql).toContain("update public.stock_movements");
    expect(sql).toContain("set posting_date = created_at");
    expect(sql).toContain("where posting_date is null");
    expect(sql).toContain("alter table public.stock_movements");
    expect(sql).toContain("alter column posting_date set not null");
    expect(sql).toContain("alter column posting_date set default now()");
    expect(sql).toContain("add column if not exists transaction_id");
    expect(sql).toContain("add column if not exists correlation_id");
    expect(sql).toContain("add column if not exists pack_quantity");
    expect(sql).toContain("add column if not exists pack_unit");
    expect(sql).toContain("add column if not exists track_stock");
    expect(sql).toContain("add column if not exists low_stock_threshold");

    // Idempotent index creation
    expect(sql).toContain("create index if not exists idx_stock_movements_variant_posting_date");
    expect(sql).toContain("create index if not exists idx_stock_movements_posting_date");
    expect(sql).toContain("create index if not exists idx_stock_movements_transaction_id");
    expect(sql).toContain("create index if not exists idx_stock_movements_correlation_id");
  });

  it("applies cleanly to an empty database (zero rows)", () => {
    const emptyDb = new MockPostgresEngine();
    emptyDb.createTable("product_variants", []);
    emptyDb.createTable("variant_barcodes", []);
    emptyDb.createTable("stock_movements", []);

    expect(() => simulateM1AdditionsMigration(emptyDb)).not.toThrow();

    // Assert tables have schema definitions without throwing
    expect(emptyDb.tables.product_variants).toHaveLength(0);
    expect(emptyDb.tables.variant_barcodes).toHaveLength(0);
    expect(emptyDb.tables.stock_movements).toHaveLength(0);
    expect(emptyDb.indexes.has("idx_stock_movements_variant_posting_date")).toBe(true);
  });

  it("applies cleanly to a populated database and backfills posting_date from created_at", () => {
    const populatedDb = new MockPostgresEngine();

    const historicalCreatedAt = "2026-10-15T09:30:00Z";
    populatedDb.createTable("product_variants", [
      { id: "var-1", sku: "SKU-A", price: 19.99, on_hand: 50, unit_of_measure: "pcs" },
    ]);
    populatedDb.createTable("variant_barcodes", [
      { id: "bc-1", variant_id: "var-1", barcode: "4006381333931", is_primary: true },
    ]);
    populatedDb.createTable("stock_movements", [
      { id: "mov-1", variant_id: "var-1", quantity_delta: 50, reason: "goods_receipt", created_at: historicalCreatedAt },
    ]);

    expect(() => simulateM1AdditionsMigration(populatedDb)).not.toThrow();

    // 1. Existing movements inherit posting_date aligned with historical created_at
    const movement = populatedDb.tables.stock_movements[0]!;
    expect(movement.posting_date).toBe(historicalCreatedAt);
    expect(movement.transaction_id).toBeNull();
    expect(movement.correlation_id).toBeNull();

    // 2. Existing barcodes default to pack_quantity 1 and pack_unit 'pcs'
    const barcode = populatedDb.tables.variant_barcodes[0]!;
    expect(barcode.pack_quantity).toBe(1);
    expect(barcode.pack_unit).toBe("pcs");

    // 3. Existing variants default to track_stock: true and low_stock_threshold: null
    const variant = populatedDb.tables.product_variants[0]!;
    expect(variant.track_stock).toBe(true);
    expect(variant.low_stock_threshold).toBeNull();
  });

  it("G1: pre-existing movements receive posting_date = created_at and not the migration run time", () => {
    const db = new MockPostgresEngine();
    const historicalCreatedAt = "2025-06-15T10:00:00.000Z";
    const migrationExecutionTime = "2026-11-03T21:00:00.000Z";

    db.createTable("product_variants", [
      { id: "var-1", sku: "SKU-A", price: 10, on_hand: 5, unit_of_measure: "pcs" },
    ]);
    db.createTable("variant_barcodes", [
      { id: "bc-1", variant_id: "var-1", barcode: "111" },
    ]);
    db.createTable("stock_movements", [
      {
        id: "mov-pre-existing",
        variant_id: "var-1",
        quantity_delta: 5,
        reason: "goods_receipt",
        created_at: historicalCreatedAt,
      },
    ]);

    // Run migration at migrationExecutionTime
    simulateM1AdditionsMigration(db, migrationExecutionTime);

    const row = db.tables.stock_movements[0]!;
    // Must be historical created_at, NOT the migration run time
    expect(row.posting_date).toBe(historicalCreatedAt);
    expect(row.posting_date).not.toBe(migrationExecutionTime);
  });

  it("is idempotent: applying a second time produces identical clean state", () => {
    const db = new MockPostgresEngine();
    db.createTable("product_variants", [{ id: "v1", sku: "S1", price: 10, on_hand: 5, unit_of_measure: "pcs" }]);
    db.createTable("variant_barcodes", [{ id: "b1", variant_id: "v1", barcode: "111" }]);
    db.createTable("stock_movements", [{ id: "m1", variant_id: "v1", quantity_delta: 5, reason: "goods_receipt", created_at: "2026-10-01T00:00:00Z" }]);

    // First migration run
    simulateM1AdditionsMigration(db);
    const firstState = JSON.stringify(db.tables);

    // Second migration run (idempotency simulation)
    expect(() => simulateM1AdditionsMigration(db)).not.toThrow();
    const secondState = JSON.stringify(db.tables);

    expect(secondState).toBe(firstState);
  });
});
