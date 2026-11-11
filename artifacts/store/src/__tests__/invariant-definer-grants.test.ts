import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// The definer-grants invariant once matched no function at all (single-line regex vs
// multi-line bodies) and looked identical to a pass. Feed it known fixtures.
const checker = path.resolve(import.meta.dirname, "../../../../scripts/audit/check-invariants.mjs");

const fn = `CREATE OR REPLACE FUNCTION public.drain_stock(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE product_variants SET on_hand = 0 WHERE id = p_id;
END;
$$;
`;

let dir = "";
function run(sql: string, later?: string) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-"));
  const migs = path.join(dir, "supabase", "migrations");
  fs.mkdirSync(migs, { recursive: true });
  fs.writeFileSync(path.join(migs, "20261201000000_fixture.sql"), sql);
  if (later) fs.writeFileSync(path.join(migs, "20261202000000_fixture_fix.sql"), later);
  return spawnSync(process.execPath, [checker, "--root", dir], { encoding: "utf8" });
}
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("security-definer-service-role-privileges", () => {
  it("fails when only public is revoked (anon/authenticated keep Supabase's default grant)", () => {
    const r = run(fn + "REVOKE EXECUTE ON FUNCTION public.drain_stock(uuid) FROM public;\nGRANT EXECUTE ON FUNCTION public.drain_stock(uuid) TO service_role;\n");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('"drain_stock" ends with EXECUTE for anon, authenticated');
  });

  it("fails when a client role is granted explicitly", () => {
    const r = run(fn + "REVOKE EXECUTE ON FUNCTION public.drain_stock(uuid) FROM public, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.drain_stock(uuid) TO authenticated, service_role;\n");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('"drain_stock" ends with EXECUTE for authenticated');
  });

  it("passes when a later migration closes the grant", () => {
    const r = run(
      fn + "REVOKE EXECUTE ON FUNCTION public.drain_stock(uuid) FROM public;\n",
      "REVOKE EXECUTE ON FUNCTION public.drain_stock(uuid) FROM public, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.drain_stock(uuid) TO service_role;\n",
    );
    expect(r.stdout).toMatch(/ok\s+security-definer-service-role-privileges\s+0 total/);
  });
});

describe("no-client-insert-policy-on-stock-movements", () => {
  const policy = `CREATE POLICY "Movements: staff insert" ON public.stock_movements FOR INSERT WITH CHECK (true);\n`;

  it("fails while a client INSERT policy is live", () => {
    const r = run(policy);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Policy "Movements: staff insert" allows client INSERT on stock_movements');
  });

  it("passes once a later migration drops it", () => {
    const r = run(policy, `DROP POLICY IF EXISTS "Movements: staff insert" ON public.stock_movements;\n`);
    expect(r.stdout).toMatch(/ok\s+no-client-insert-policy-on-stock-movements\s+0 total/);
  });
});
