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

  it("fails when GRANT ALL ON ALL TABLES IN SCHEMA public is given to authenticated", () => {
    const badSql = `
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    `;
    const r = runFixture(badSql);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no-client-writes-on-counter-sale-payments");
  });

  it("fails when GRANT INSERT lists multiple tables including counter_sale_payments", () => {
    const badSql = `
      GRANT INSERT ON public.counter_sales, public.counter_sale_payments TO authenticated;
    `;
    const r = runFixture(badSql);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no-client-writes-on-counter-sale-payments");
  });

  it("fails when an unquoted policy grants client INSERT on counter_sale_payments", () => {
    const badSql = `
      CREATE POLICY client_insert ON public.counter_sale_payments FOR INSERT TO authenticated WITH CHECK (true);
    `;
    const r = runFixture(badSql);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no-client-writes-on-counter-sale-payments");
  });

  it("fails when GRANT INSERT uses quoted identifiers for schema and table", () => {
    const badSql = `
      GRANT INSERT ON "public"."counter_sale_payments" TO authenticated;
    `;
    const r = runFixture(badSql);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no-client-writes-on-counter-sale-payments");
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

describe("post-counter-sale-writes-payments invariant", () => {
  it("fails when the last migration defining post_counter_sale omits payment insert", () => {
    const badSql = `
      CREATE OR REPLACE FUNCTION public.post_counter_sale(p_sale jsonb, p_hash text, p_user uuid)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO public.counter_sales (id) VALUES ((p_sale->>'id')::uuid);
        RETURN jsonb_build_object('ok', true);
      END;
      $$;
    `;
    const r = runFixture(badSql);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("post-counter-sale-writes-payments");
    expect(r.stdout).toContain("does not insert into counter_sale_payments");
  });

  it("passes when the last migration defining post_counter_sale inserts into counter_sale_payments", () => {
    const goodSql = `
      CREATE OR REPLACE FUNCTION public.post_counter_sale(p_sale jsonb, p_hash text, p_user uuid)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO public.counter_sales (id) VALUES ((p_sale->>'id')::uuid);
        INSERT INTO public.counter_sale_payments (sale_id, method, amount) VALUES ((p_sale->>'id')::uuid, 'cash', 10);
        RETURN jsonb_build_object('ok', true);
      END;
      $$;
    `;
    const r = runFixture(goodSql);
    expect(r.stdout).toMatch(/ok\s+post-counter-sale-writes-payments\s+0 total/);
  });
});

