import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import type { Request } from "express";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";
import { requireAdmin as resolveAdmin } from "../src/lib/supabase.js";

/**
 * SEC-001 — Privilege escalation via `users.role` self-update.
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    2 (exploration) — re-run by task 6.1 (fix-check)
 * Design:  Property 1 — Bug Condition: role is immutable from the client.
 * Requirements: 1.1 (current defect), 2.1 (expected behavior after fix).
 *
 * ── Bug condition (from bugfix.md SEC-001 derivation) ──────────────────────
 *   isBugCondition(X) = X.caller = 'authenticated'   // anon-key JWT, not service role
 *                   AND X.table  = 'users'
 *                   AND X.op     = 'UPDATE'
 *                   AND 'role' ∈ X.columns
 *
 * This is an RLS-level integration test: the *policy* is the assertion. It runs
 * in the CI `integration-e2e` job (Supabase with anon + service-role keys and a
 * running API server). It is NOT a pure unit test and is expected to be a no-op
 * locally unless those keys + server are present.
 *
 * ── Switchable expected outcome (exploration → fix-check) ──────────────────
 * The SAME test is run twice across the bugfix lifecycle:
 *
 *   • UNFIXED code (task 2, the default):   SEC001_FIXED unset/"0"
 *       → the anon-key `update({ role: 'admin' })` is ACCEPTED (the defect).
 *         `users.role` becomes 'admin' and the `requireAdmin` trust chain then
 *         grants `/admin/*`. This captures the counterexample proving the bug.
 *
 *   • FIXED code (task 6.1):                SEC001_FIXED="1"
 *       → the same write is REJECTED (RLS `42501` / no row mutated), `users.role`
 *         stays 'customer', and `requireAdmin` still resolves to null (403).
 *
 * Flip the expectation by setting the env var SEC001_FIXED=1 after the SEC-001
 * migration lands. No second test file is written (per task 6.1).
 *
 * ── Counterexample captured on UNFIXED code (live DB confirmed via service role)
 *   public.users policies:   users_own_read (SELECT), users_own_update (UPDATE,
 *                            USING auth.uid()=id, WITH CHECK = null → uses USING,
 *                            NO column restriction)
 *   role-immutability trigger: NONE
 *   users_role_check:        CHECK (role = ANY (ARRAY['admin','customer']))  // 'admin' allowed
 *   ⇒ anon-key update({ role: 'admin' }).eq('id', auth.uid()) returns 200 and
 *     row.role becomes 'admin'  →  full privilege escalation.
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000";

// Expected-outcome toggle. Default (unset) = UNFIXED code = bug is present.
const EXPECT_FIXED = process.env.SEC001_FIXED === "1";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

describe("SEC-001 exploration: users.role self-update via anon client (Property 1)", () => {
  let session: AuthSession;
  const phone = generatePhone();

  // Service-role client bypasses RLS — used only to observe/reset ground truth.
  const admin: SupabaseClient<Database> = createClient<Database>(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  beforeAll(async () => {
    session = await loginTestUser(BASE_URL, phone);
    // Ground truth: a fresh signup is a 'customer'. Force it, defensively, so the
    // test is independent of run order (vitest runs this project with shuffle on).
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
  });

  afterAll(async () => {
    if (session?.userId) {
      // Reset role then remove the throwaway user + dependent rows.
      await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
      await cleanupTestUser(session.userId);
    }
  });

  /**
   * Build an anon-key client bound to the logged-in user's JWT. This is exactly
   * the storefront's browser client: RLS evaluates it as `authenticated` with
   * `auth.uid() = session.userId`. Service role is NOT used here.
   */
  function authedAnonClient(accessToken: string): SupabaseClient<Database> {
    return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  it("anon-key self-update of users.role (the escalation write)", async () => {
    // Clean starting state regardless of shuffle / prior runs.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);

    const anon = authedAnonClient(session.accessToken);

    // THE BUG CONDITION: caller=authenticated, table=users, op=UPDATE, role∈columns
    const { data, error } = await anon
      .from("users")
      .update({ role: "admin" })
      .eq("id", session.userId)
      .select("id, role");

    // Read the persisted ground truth via the service role (bypasses RLS).
    const { data: persisted } = await admin
      .from("users")
      .select("role")
      .eq("id", session.userId)
      .single();

    if (EXPECT_FIXED) {
      // Fix-check (task 6.1): the write must be REJECTED and role unchanged.
      // The fix makes `users` SELECT-only for clients (no UPDATE policy) plus a
      // before-update trigger raising 42501 — so either an RLS error is returned
      // or zero rows are mutated. Asserting on the persisted role is robust to
      // both shapes; if an error is present it should carry code 42501.
      expect(persisted?.role).toBe("customer");
      if (error) {
        expect(error.code).toBe("42501");
      } else {
        // No error path: the row must simply not have been mutated.
        expect(data ?? []).toEqual([]);
      }
    } else {
      // EXPLORATION (task 2, UNFIXED): the write is ACCEPTED — this is the defect.
      // Counterexample: anon-key update({role:'admin'}) returns no error and
      // public.users.role becomes 'admin'.
      expect(error).toBeNull();
      expect(data?.[0]?.role).toBe("admin");
      expect(persisted?.role).toBe("admin");
    }
  });

  it("escalated role grants admin via the requireAdmin trust chain", async () => {
    // Clean starting state, then perform the real attack through the anon client.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);

    const anon = authedAnonClient(session.accessToken);
    await anon.from("users").update({ role: "admin" }).eq("id", session.userId).select("id");

    // The legacy `requireAdmin(req)` resolver (lib/supabase.ts) — cited by the
    // SEC-001 trust chain — reads users.role via the service role and trusts it.
    // The Express `requireAdmin` middleware delegates to this same resolver, so a
    // non-null result here means the caller is granted `/admin/*`.
    const req = {
      headers: { authorization: `Bearer ${session.accessToken}` },
    } as unknown as Request;

    const ctx = await resolveAdmin(req);

    if (EXPECT_FIXED) {
      // Fix-check (task 6.1): the anon write was rejected, role stayed 'customer',
      // so the trust chain still denies admin (middleware would return 403).
      const { data: persisted } = await admin
        .from("users")
        .select("role")
        .eq("id", session.userId)
        .single();
      expect(persisted?.role).toBe("customer");
      expect(ctx).toBeNull();
    } else {
      // EXPLORATION (task 2, UNFIXED): the self-escalated customer now resolves
      // as an admin — the full privilege-escalation chain is demonstrated.
      expect(ctx).not.toBeNull();
      expect(ctx?.user?.id).toBe(session.userId);
    }
  });
});
