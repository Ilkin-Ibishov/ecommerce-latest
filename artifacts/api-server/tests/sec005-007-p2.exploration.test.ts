import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/**
 * SEC-005 / SEC-006 / SEC-007 — P2 hardening / misconfiguration findings.
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    17 (exploration) — re-run by tasks 18/19/20 fix-checks
 * Design:  Property 5 (recursion-safe admin policies),
 *          Property 6 (fail fast on missing service key),
 *          Property 7 (no control-plane credential in the browser).
 * Requirements: 1.5/1.6/1.7 (current conditions), 2.5/2.6/2.7 (expected after fix).
 *
 * ── IMPORTANT NUANCE: these are NOT all classic "succeeds-when-it-shouldn't" bugs
 *
 *   • SEC-005 is a REFUTED runtime fault → downgraded to MAINTAINABILITY hardening.
 *     The audit hypothesised infinite-recursion (`42P17`) from admin RLS policies
 *     that subquery `users`. The live database does NOT recurse: a direct
 *     authenticated `select` on `users` / `audit_log` returns `200 []` with NO
 *     `42P17`. This file therefore asserts the REFUTATION (no recursion error) as
 *     an INVARIANT that holds on BOTH unfixed and fixed code — it is honest about
 *     the fact that SEC-005's fix (task 18) is a maintainability rewrite to
 *     `public.is_admin()`, not a runtime-fault repair.
 *
 *   • SEC-006 and SEC-007 ARE capture-the-counterexample conditions and use the
 *     `P2_FIXED` toggle that flips the expectation once the fix lands (mirrors
 *     `SEC001_FIXED` / `P1_FIXED`).
 *
 * ── SEC-005 live observation (Supabase MCP, service role), task 17 ────────────
 *   Inline-`users`-subquery policies found LIVE (the maintainability-rewrite
 *   targets for task 18):
 *     • `audit_admin_read`  ON public.audit_log (SELECT):
 *         EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
 *     • `Pages: admin all`  ON public.pages (ALL):
 *         EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
 *   NUANCE vs design: the live `public.users` table has NO policy that subqueries
 *   `users`. Its only policies are `users_own_read` (SELECT, auth.uid() = id) and
 *   `users_own_update` (UPDATE, auth.uid() = id) — both non-recursive. Because the
 *   `users` table's OWN policies do not self-reference, the `audit_log` / `pages`
 *   admin policies that subquery `users` resolve safely → no `42P17`. This is the
 *   structural reason the recursion never reproduces, and it is why SEC-005 is
 *   recorded as fragility/maintainability hardening, not a confirmed runtime fault.
 *   (Full policy-name documentation: `exploration-p2-notes.md`.)
 *
 * ── SEC-006 counterexample captured on UNFIXED code ───────────────────────────
 *   `artifacts/api-server/src/lib/supabase.ts` builds the admin client with
 *   `createClient(url, serviceKey || anonKey, …)`. With `SUPABASE_SERVICE_ROLE_KEY`
 *   unset, `getAdminSupabase()` SILENTLY returns an anon-key client (no throw) —
 *   an "admin" client that is actually subject to RLS. The fix (task 19) makes it
 *   throw. Counterexample: getAdminSupabase() returns a truthy client when the
 *   service key is unset instead of failing fast.
 *
 * ── SEC-007 counterexample captured on UNFIXED code ───────────────────────────
 *   `vercel.json` ships `VITE_CONTROL_PLANE_SUPABASE_URL` and
 *   `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` in the storefront `build.env`, so the
 *   control-plane anon credential is bundled into every browser
 *   (`artifacts/store/src/lib/platform/client.ts` constructs a browser
 *   control-plane client from them). The fix (task 20.1) removes both keys.
 *   Counterexample: the control-plane anon key is present in vercel.json today.
 *
 * ── Switchable expected outcome (exploration → fix-check) for SEC-006 / SEC-007 ─
 *   • UNFIXED code (task 17, default):   P2_FIXED unset/"0"
 *       → SEC-006: getAdminSupabase() returns a client when the service key is
 *         unset (silent anon fallback — the defect).
 *       → SEC-007: vercel.json build.env CONTAINS VITE_CONTROL_PLANE_* (the defect).
 *   • FIXED code (tasks 19 / 20.1):      P2_FIXED="1"
 *       → SEC-006: getAdminSupabase() THROWS when the service key is unset.
 *       → SEC-007: vercel.json build.env contains NO control-plane credential.
 *   Flip by setting P2_FIXED=1 after the P2 changes land. No second file is written.
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000";

// Expected-outcome toggle for SEC-006 / SEC-007. Default (unset) = UNFIXED code.
const EXPECT_FIXED = process.env.P2_FIXED === "1";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

/** Postgres recursion / "infinite recursion detected in policy" error code. */
const RECURSION_ERRCODE = "42P17";

/** An anon-key client bound to a user JWT — RLS evaluates it as `authenticated`. */
function authedAnonClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// SEC-005 — recursion REFUTED → maintainability hardening (Property 5)
//   This assertion is an INVARIANT: no recursion error on unfixed OR fixed code.
//   It documents the refutation; it is NOT a runtime-fault capture.
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-005 exploration: direct authenticated select raises NO 42P17 (Property 5 — REFUTATION)", () => {
  let session: AuthSession;
  const phone = generatePhone();

  beforeAll(async () => {
    session = await loginTestUser(BASE_URL, phone);
  });

  afterAll(async () => {
    if (session?.userId) await cleanupTestUser(session.userId);
  });

  it("authenticated SELECT on users does NOT raise infinite-recursion (42P17)", async () => {
    const authed = authedAnonClient(session.accessToken);

    // THE (refuted) bug condition: a policy on users that subqueries users would
    // recurse. Live `users` policies are own-row only, so this must NOT recurse.
    const { data, error } = await authed.from("users").select("id, role");

    // INVARIANT (holds unfixed AND fixed): no recursion error of any kind.
    expect(error?.code).not.toBe(RECURSION_ERRCODE);
    // The select completes (RLS filters rows; an empty/own-row result, never a fault).
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("authenticated SELECT on audit_log does NOT raise infinite-recursion (42P17)", async () => {
    const authed = authedAnonClient(session.accessToken);

    // `audit_admin_read` subqueries `users`; because `users`' own policies are
    // non-recursive, evaluating this policy is safe → no 42P17, just 0 rows for a
    // non-admin. This is exactly the refutation recorded in design.md.
    const { data, error } = await authed.from("audit_log").select("id");

    expect(error?.code).not.toBe(RECURSION_ERRCODE);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Non-admin sees no audit rows — access decision is correct and preserved.
    expect(data ?? []).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SEC-006 — getAdminSupabase() silent anon fallback (Property 6)
//   Pure unit test (no DB/server): exercises the `serviceKey || anonKey` fallback
//   by re-importing the module with SUPABASE_SERVICE_ROLE_KEY unset.
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-006 exploration: getAdminSupabase() with the service key unset (Property 6)", () => {
  it("currently returns a client (silent anon fallback) instead of failing fast", async () => {
    const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      // Bug condition: api-server startup with SUPABASE_SERVICE_ROLE_KEY UNSET.
      // The module reads env at import time, so reset + re-import after deleting it.
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      vi.resetModules();
      const mod = await import("../src/lib/supabase");

      if (EXPECT_FIXED) {
        // Fix-check (task 19): the fallback is removed → getAdminSupabase() throws.
        expect(() => mod.getAdminSupabase()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
      } else {
        // EXPLORATION (task 17, UNFIXED): `serviceKey || anonKey` silently yields
        // an anon-key client — a real, usable client that is NOT service-role and
        // is therefore subject to RLS. Counterexample: no throw, truthy client.
        const client = mod.getAdminSupabase();
        expect(client).toBeTruthy();
        expect(typeof client.from).toBe("function");
      }
    } finally {
      // Restore env + module cache so the rest of the suite sees the real module.
      if (original === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = original;
      vi.resetModules();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SEC-007 — control-plane credential bundled into the browser (Property 7)
//   Pure file assertion: reads the repo-root vercel.json.
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-007 exploration: control-plane credential present in vercel.json (Property 7)", () => {
  // tests/ → api-server → artifacts → repo root
  const vercelJsonPath = resolve(import.meta.dirname, "../../../vercel.json");

  function readBuildEnv(): Record<string, string> {
    const raw = readFileSync(vercelJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { build?: { env?: Record<string, string> } };
    return parsed.build?.env ?? {};
  }

  it("vercel.json storefront build.env ships VITE_CONTROL_PLANE_* (the bundled credential)", () => {
    const env = readBuildEnv();

    if (EXPECT_FIXED) {
      // Fix-check (task 20.1): both control-plane keys are removed from the bundle.
      expect(env.VITE_CONTROL_PLANE_SUPABASE_URL).toBeUndefined();
      expect(env.VITE_CONTROL_PLANE_SUPABASE_ANON_KEY).toBeUndefined();
    } else {
      // EXPLORATION (task 17, UNFIXED): the control-plane URL + anon key are baked
      // into the storefront build env, so they are shipped to every browser.
      // Counterexample: the anon credential is present in vercel.json today.
      expect(env.VITE_CONTROL_PLANE_SUPABASE_URL).toBeTruthy();
      expect(env.VITE_CONTROL_PLANE_SUPABASE_ANON_KEY).toBeTruthy();
      // It is a real anon JWT (role:"anon"), not a placeholder.
      expect(env.VITE_CONTROL_PLANE_SUPABASE_ANON_KEY).toMatch(/^eyJ/);
    }
  });
});
