import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeStocktakeVariance } from "../../../../artifacts/api-server/src/lib/stocktake-variance";

/**
 * M2b Stocktake Variance Service Unit Suite
 *
 * Verifies:
 * 1. Missing snapshot invariant: a line missing a snapshot must fail the request and
 *    must NEVER report a variance computed from current on-hand.
 * 2. Snapshot query scoping: the snapshot query is strictly scoped to the lines
 *    of the stocktake under review, preventing table-wide fetches and cross-stocktake leakage.
 */

interface QueryCall {
  table: string;
  filters: Array<{ method: string; column: string; value: any }>;
}

function createMockAdmin(data: {
  stocktakes?: any[]; lines?: any[]; snapshots?: any[];
  resolutions?: any[]; variants?: any[]; costs?: any[]; movements?: any[];
}) {
  const queryLog: QueryCall[] = [];

  const admin = {
    from: (table: string) => {
      const call: QueryCall = { table, filters: [] };
      queryLog.push(call);
      let countExact = false;

      const builder: any = {
        select: (_fields: string, opts?: any) => {
          if (opts?.count === "exact") countExact = true;
          return builder;
        },
        eq: (col: string, val: any) => { call.filters.push({ method: "eq", column: col, value: val }); return builder; },
        in: (col: string, vals: any[]) => { call.filters.push({ method: "in", column: col, value: vals }); return builder; },
        single: async () => {
          const rows = admin._getTableData(table, call.filters);
          return { data: rows[0] ?? null, error: rows[0] ? null : { message: "Not found" } };
        },
        then: (resolve: any) => {
          if (countExact) { resolve({ count: (data.variants ?? []).length, data: null, error: null }); return; }
          resolve({ data: admin._getTableData(table, call.filters), error: null });
        },
      };
      return builder;
    },
    _getTableData: (table: string, filters: QueryCall["filters"]) => {
      const tableMap: Record<string, any[] | undefined> = {
        stocktakes: data.stocktakes, stocktake_lines: data.lines,
        stocktake_line_snapshots: data.snapshots, stocktake_resolutions: data.resolutions,
        product_variants: data.variants, variant_costs: data.costs, stock_movements: data.movements,
      };
      const rows = tableMap[table] ?? [];
      return rows.filter((r) => filters.every((f) => {
        if (f.method === "eq") return r[f.column] === f.value;
        if (f.method === "in") return Array.isArray(f.value) && f.value.includes(r[f.column]);
        return true;
      }));
    },
    _getQueryLog: () => queryLog,
  };

  return admin as any;
}

describe("M2b Stocktake Variance Snapshot Scoping & Invariant Guards", () => {
  it("fails variance review when a line's snapshot row is missing and NEVER falls back to current on-hand", async () => {
    // Current on-hand is 10, counted quantity is 8.
    // If it fell back to current on-hand, variance would be computed as 8 - 10 = -2.
    const admin = createMockAdmin({
      stocktakes: [{ id: "st-1", status: "draft", is_opening_count: false }],
      lines: [{
        id: "line-missing-snap",
        stocktake_id: "st-1",
        variant_id: "var-1",
        counter_id: "u1",
        counted_quantity: 8,
        created_at: new Date(1000).toISOString(),
      }],
      snapshots: [], // Snapshot deliberately omitted (broken invariant)
      variants: [{
        id: "var-1",
        sku: "SKU-001",
        on_hand: 10, // current on-hand now
        products: { title: "Test Product", categories: null },
      }],
      costs: [{ variant_id: "var-1", cost_price: 25.0 }],
      movements: [],
    });

    let reportedResult: any = null;
    let thrownError: any = null;

    try {
      reportedResult = await computeStocktakeVariance(admin, "st-1");
    } catch (err: any) {
      thrownError = err;
    }

    // Invariant guard: must reject rather than succeed with fallback
    expect(reportedResult).toBeNull();
    expect(thrownError).toBeDefined();
    expect(thrownError.message).toMatch(/missing snapshot for stocktake line line-missing-snap/i);

    // Negative proof: ensure no variance was calculated from current on-hand (8 - 10 = -2)
    expect(reportedResult?.items?.[0]?.snapshot_on_hand).not.toBe(10);
    expect(reportedResult?.items?.[0]?.variance_quantity).not.toBe(-2);
  });

  it("strictly scopes stocktake_line_snapshots query to lines of this stocktake", async () => {
    // Two stocktakes in database: st-1 (line-1) and st-2 (line-2)
    const admin = createMockAdmin({
      stocktakes: [
        { id: "st-1", status: "draft", is_opening_count: false },
        { id: "st-2", status: "draft", is_opening_count: false },
      ],
      lines: [
        {
          id: "line-1",
          stocktake_id: "st-1",
          variant_id: "var-1",
          counter_id: "u1",
          counted_quantity: 12,
          created_at: new Date(1000).toISOString(),
        },
      ],
      snapshots: [
        { line_id: "line-1", snapshot_on_hand: 10, captured_at: new Date(1000).toISOString() },
        { line_id: "line-2-unrelated", snapshot_on_hand: 50, captured_at: new Date(1000).toISOString() },
      ],
      variants: [{
        id: "var-1",
        sku: "SKU-001",
        on_hand: 7, // Sales occurred after count: on-hand dropped from 10 to 7
        products: { title: "Test Product", categories: null },
      }],
      costs: [{ variant_id: "var-1", cost_price: 15.0 }],
      movements: [],
    });

    const report = await computeStocktakeVariance(admin, "st-1");

    // 1. Verify variance calculation uses captured snapshot (10), NOT current on-hand (7)
    // Variance = counted (12) - snapshot (10) = +2
    expect(report.items.length).toBe(1);
    expect(report.items[0].snapshot_on_hand).toBe(10);
    expect(report.items[0].current_on_hand).toBe(7);
    expect(report.items[0].variance_quantity).toBe(2);

    // 2. Verify snapshots query scoping
    const queryLog: QueryCall[] = admin._getQueryLog();
    const snapshotQueries = queryLog.filter((q) => q.table === "stocktake_line_snapshots");

    expect(snapshotQueries.length).toBe(1);
    const lineIdFilter = snapshotQueries[0].filters.find((f) => f.column === "line_id");
    expect(lineIdFilter).toBeDefined();
    expect(lineIdFilter?.method).toBe("in");
    // Strictly scoped to ["line-1"], never includes "line-2-unrelated"
    expect(lineIdFilter?.value).toEqual(["line-1"]);
  });

  it("regression guard: static inspection confirms query scoping and absence of currentOnHand fallback", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const filePath = path.join(root, "artifacts/api-server/src/lib/stocktake-variance.ts");
    const code = fs.readFileSync(filePath, "utf-8");

    // Scoped query requirement
    expect(code).toContain('.from("stocktake_line_snapshots")');
    expect(code).toContain('.in("line_id", lineIds)');

    // Missing snapshot guard requirement: forbidden fallback
    expect(code).not.toContain("snapshotMap.get(latestLine.id) ?? currentOnHand");
    expect(code).not.toContain("?? currentOnHand");
  });
});
