import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const checker = path.resolve(import.meta.dirname, "../../../../scripts/audit/check-invariants.mjs");
const rootDir = path.resolve(import.meta.dirname, "../../../../");

let tmpDir = "";
function runFixture(sql: string) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-pm-"));
  const migs = path.join(tmpDir, "supabase", "migrations");
  fs.mkdirSync(migs, { recursive: true });
  fs.writeFileSync(path.join(migs, "20261201000000_fixture.sql"), sql);
  return spawnSync(process.execPath, [checker, "--root", tmpDir], { encoding: "utf8" });
}
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("no-client-writes-on-counter-sale-payments invariant", () => {
  it("fails when a migration grants INSERT on counter_sale_payments to authenticated", () => {
    const badSql = `
      CREATE TABLE public.counter_sale_payments (sale_id uuid, method text, amount numeric);
      GRANT INSERT ON public.counter_sale_payments TO authenticated;
    `;
    const r = runFixture(badSql);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Migration grants INSERT on counter_sale_payments to client role: authenticated");
  });

  it("fails when a migration grants ALL on counter_sale_payments to anon", () => {
    const badSql = `
      CREATE TABLE public.counter_sale_payments (sale_id uuid, method text, amount numeric);
      GRANT ALL ON public.counter_sale_payments TO anon;
    `;
    const r = runFixture(badSql);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Migration grants ALL on counter_sale_payments to client role: anon");
  });

  it("fails when an RLS policy grants client INSERT on counter_sale_payments", () => {
    const badSql = `
      CREATE TABLE public.counter_sale_payments (sale_id uuid, method text, amount numeric);
      ALTER TABLE public.counter_sale_payments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Client insert" ON public.counter_sale_payments FOR INSERT TO authenticated WITH CHECK (true);
    `;
    const r = runFixture(badSql);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Policy "Client insert" allows client INSERT on counter_sale_payments');
  });

  it("passes when only SELECT is granted to client and writes are denied", () => {
    const goodSql = `
      CREATE TABLE public.counter_sale_payments (sale_id uuid, method text, amount numeric);
      ALTER TABLE public.counter_sale_payments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Admin read" ON public.counter_sale_payments FOR SELECT TO authenticated USING (true);
      REVOKE ALL ON public.counter_sale_payments FROM public, anon, authenticated;
      GRANT SELECT ON public.counter_sale_payments TO authenticated;
      GRANT ALL ON public.counter_sale_payments TO service_role;
    `;
    const r = runFixture(goodSql);
    expect(r.stdout).toMatch(/ok\s+no-client-writes-on-counter-sale-payments\s+0 total/);
  });
});

describe("counter_sale_payments schema migrations integrity", () => {
  it("20261113230100_payment_methods.sql seeds all 4 tenders and enables RLS", () => {
    const sql = fs.readFileSync(path.join(rootDir, "supabase/migrations/20261113230100_payment_methods.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.payment_methods");
    expect(sql).toContain("code text PRIMARY KEY");
    expect(sql).toContain("'cash', 'Cash'");
    expect(sql).toContain("'card', 'Card'");
    expect(sql).toContain("'bank_transfer', 'Bank Transfer'");
    expect(sql).toContain("'other', 'Other'");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("GRANT SELECT ON public.payment_methods TO authenticated");
  });

  it("20261113230200_counter_sale_payments.sql enforces immutability and deferred sum trigger", () => {
    const sql = fs.readFileSync(path.join(rootDir, "supabase/migrations/20261113230200_counter_sale_payments.sql"), "utf8");
    expect(sql).toContain("PRIMARY KEY (sale_id, method)");
    expect(sql).toContain("CHECK (amount >= 0)");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("trg_counter_sale_payments_immutable");
    expect(sql).toContain("2BP01");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON public.counter_sale_payments");
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toContain("chk_counter_sale_payments_sum");
    expect(sql).toContain("chk_counter_sales_has_payments");
    expect(sql).toContain("ST027");
  });

  it("20261113230300_counter_sale_payments_backfill.sql is idempotent and covers all statuses", () => {
    const sql = fs.readFileSync(path.join(rootDir, "supabase/migrations/20261113230300_counter_sale_payments_backfill.sql"), "utf8");
    expect(sql).toContain("INSERT INTO public.counter_sale_payments (sale_id, method, amount, created_at)");
    expect(sql).toContain("cs.payment_method,");
    expect(sql).toContain("cs.total_amount,");
    expect(sql).toContain("ON CONFLICT (sale_id, method) DO NOTHING");
  });

  it("20261113230400_post_counter_sale_payments.sql atomically inserts into counter_sale_payments", () => {
    const sql = fs.readFileSync(path.join(rootDir, "supabase/migrations/20261113230400_post_counter_sale_payments.sql"), "utf8");
    expect(sql).toContain("INSERT INTO public.counter_sale_payments (sale_id, method, amount, created_at)");
    expect(sql).toContain("VALUES (v_id, p_sale->>'payment_method', v_total, v_posting)");
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.post_counter_sale(jsonb, text, uuid) FROM public, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.post_counter_sale(jsonb, text, uuid) TO service_role");
  });
});
