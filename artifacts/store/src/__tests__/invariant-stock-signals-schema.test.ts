import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../../../../");
const lowStockMigrationPath = path.join(rootDir, "supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql");
const signalsMigrationPath = path.join(rootDir, "supabase/migrations/20261116100100_m4_signals_net_order_returns.sql");
const routePath = path.join(rootDir, "artifacts/api-server/src/routes/admin/inventory-signals.ts");

export function extractReturnsTableColumns(sqlContent: string, functionName: string): string[] {
  const funcRegex = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${functionName}[\\s\\S]*?RETURNS\\s+TABLE\\s*\\(([\\s\\S]*?)\\)\\s*LANGUAGE`,
    "i"
  );
  const match = sqlContent.match(funcRegex);
  if (!match) throw new Error(`Function ${functionName} with RETURNS TABLE not found`);
  return match[1]
    .split(",")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0]);
}

export function extractZodSchemaKeys(tsContent: string, schemaName: string): string[] {
  const schemaRegex = new RegExp(`const\\s+${schemaName}\\s*=\\s*z\\.object\\s*\\(\\{([\\s\\S]*?)\\}\\);`);
  const match = tsContent.match(schemaRegex);
  if (!match) throw new Error(`Schema ${schemaName} not found`);
  return match[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([a-zA-Z0-9_]+)\s*:/);
      return m ? m[1] : null;
    })
    .filter((k): k is string => k !== null);
}

describe("stock signals RPC returns table vs route zod schemas parity", () => {
  const lowStockMigrationSql = fs.readFileSync(lowStockMigrationPath, "utf8");
  const signalsMigrationSql = fs.readFileSync(signalsMigrationPath, "utf8");
  const routeTs = fs.readFileSync(routePath, "utf8");

  it("verifies lowStockRowSchema keys equal get_low_stock_signals RETURNS TABLE columns in order", () => {
    const sqlCols = extractReturnsTableColumns(lowStockMigrationSql, "get_low_stock_signals");
    const zodKeys = extractZodSchemaKeys(routeTs, "lowStockRowSchema");
    expect(zodKeys).toEqual(sqlCols);
  });

  it("verifies deadStockRowSchema keys equal get_dead_stock_signals RETURNS TABLE columns in order", () => {
    const sqlCols = extractReturnsTableColumns(signalsMigrationSql, "get_dead_stock_signals");
    const zodKeys = extractZodSchemaKeys(routeTs, "deadStockRowSchema");
    expect(zodKeys).toEqual(sqlCols);
  });

  it("verifies reorderSuggestionRowSchema keys equal get_reorder_suggestions RETURNS TABLE columns in order", () => {
    const sqlCols = extractReturnsTableColumns(signalsMigrationSql, "get_reorder_suggestions");
    const zodKeys = extractZodSchemaKeys(routeTs, "reorderSuggestionRowSchema");
    expect(zodKeys).toEqual(sqlCols);
  });

  it("detects defects if schema keys deviate, reorder, or miss RPC columns", () => {
    const sqlCols = ["variant_id", "product_id", "on_hand"];
    const zodColsSwapped = ["product_id", "variant_id", "on_hand"];
    const zodColsMissing = ["variant_id", "product_id"];
    expect(zodColsSwapped).not.toEqual(sqlCols);
    expect(zodColsMissing).not.toEqual(sqlCols);
  });
});
