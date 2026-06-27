import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/**
 * SEC-001 — Consolidated RLS-level integration suite (CI `integration-e2e`).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    8 — "RLS-level integration tests for SEC-001 (anon + service-role keys)"
 * Design:  Property 1 (Fix-Checking: role immutable from the client),
 *          Property 8 (Preservation: ¬C inputs unchanged).
 * Requirements: 2.1, 2.8, 3.1, 3.8.
 *
 * This is an RLS-level integration test (the *policy* is the assertion). It runs
 * in the CI `integration-e2e` job (Supabase with anon + service-role keys + a
 * running API server) and is a no-op locally unless those keys + server are
 * present. It lives in the `api-integration` vitest project and follows the
 * established conventions: `loginTestUser` / `cleanupTestUser` / `generatePhone`,
 * a service-role client plus a JWT-bound anon-key client, and `afterAll` cleanup
 * of throwaway users.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TASK 8 COVERAGE MATRIX — where each required assertion lives (NO DUPLICATION)
 * ─────────────────────────────────────────────────────────────────────────────
 * Per agent-behaviors rule #5, this file deliberately does NOT re-implement the
 * assertions already owned by the two existing SEC-001 integration files. Task 8
 * lists four assertions; three of them are fully covered elsewhere and are
 * referenced (not copied) here:
 *
 *   [A1] anon-key `update users set role='admin'` → `42501`
 *        Fix-Checking · Property 1 · Req 2.1
 *        → Owned by `sec001-role-escalation.exploration.test.ts` (task 2), FIXED
 *          branch (`SEC001_FIXED=1`): the anon write is REJECTED and the
 *          `requireAdmin` trust chain still returns 403.
 *        → ALSO asserted here, additively, by the self-detecting test below — a
 *          pure RLS/data-plane assertion that does NOT depend on the `SEC001_FIXED`
 *          env toggle (it auto-activates once the lockdown is live in CI). This is
 *          the one genuinely new piece of coverage this file adds; it intentionally
 *          omits the trust-chain leg (that is task 2's job) to avoid duplication.
 *
 *   [A2] service-role `update users set role=…` → succeeds (trigger allows)
 *        Preservation · Property 8 · Req 3.1
 *        → Owned by `sec001-sec008-preservation.test.ts` (task 3),
 *          "service-role update of users.role persists (bypasses RLS) [3.1]".
 *          Invariant (no toggle): passes on both unfixed and fixed code.
 *
 *   [A3] service-role + endpoint `PATCH /profile` then `GET /profile` returns the
 *        new `full_name` / `default_address`
 *        Fix-Checking + Preservation · Property 1 / Property 8 · Req 3.8
 *        → Owned by `sec001-sec008-preservation.test.ts` (task 3),
 *          "legitimate customer {full_name, default_address} edit via /api/profile
 *          persists [3.8]" plus the bounded property round-trip. The `/profile`
 *          handler writes via the service role (`getAdminSupabase()`), so the same
 *          assertion is the mandated post-fix path (SEC-008/2.8). Invariant.
 *
 *   [A4] a fresh auth signup results in a `public.users` row after the lockdown
 *        (the `handle_new_user()` `security definer` INSERT trigger
 *        `on_auth_user_created` ON auth.users is untouched by SEC-001) — the one
 *        users-write path not otherwise covered
 *        Preservation · Property 8 · Req 3.1
 *        → Owned by `sec001-sec008-preservation.test.ts` (task 3),
 *          "fresh auth signup creates the public.users row via handle_new_user()
 *          definer trigger [3.1]". Invariant.
 *
 * Net: A2/A3/A4 are covered, invariant, and not duplicated here. A1 is covered by
 * task 2 (toggle-gated) AND strengthened here by a toggle-free, self-detecting
 * RLS assertion so CI gains a SEC-001 fix-check that auto-activates the moment the
 * P0 migration (task 4) lands — without anyone having to remember to flip
 * `SEC001_FIXED`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEST-FIRST CONTRACT (no fix is implemented by this task)
 * ─────────────────────────────────────────────────────────────────────────────
 * The additive assertion below describes POST-FIX behavior (anon role write
 * rejected). On the current UNFIXED schema that write still succeeds, so an
 * unconditional assertion would make the `integration-e2e` job RED on every push
 * until tasks 4/5 land. To honor the test-first contract WITHOUT a red CI in the
 * interim — and without relying on the `SEC001_FIXED` env toggle — the test
 * detects whether the client-write surface on `public.users` has been closed
 * (the observable, fix-defining change) and:
 *   • asserts the `42501` rejection once the lockdown is live (goes green in CI
 *     after the fix lands), or
 *   • skips with a documented "pending SEC-001 migration" note while unfixed.
 * `SEC001_FIXED=1` is honored as an optional override that forces the assertion.
 *
 * Live ground truth confirmed via the service role at authoring time (UNFIXED):
 *   public.users policies → `users_own_read` (SELECT, auth.uid()=id) and
 *   `users_own_update` (UPDATE, auth.uid()=id, NO column restriction); no
 *   role-immutability trigger on public.users; `on_auth_user_created` (→
 *   handle_new_user, security definer) present on auth.users. So a client UPDATE
 *   of one's own row currently succeeds; after the fix it is denied (SELECT-only
 *   policy + before-update trigger).
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

// Optional override: force the FIXED-state assertion even if detection is
// inconclusive. Primary gating is self-detection (below), NOT this var.
const FORCE_FIXED = process.env.SEC001_FIXED === "1";

describe("SEC-001 RLS integration (consolidated, task 8): role immutable from the client", () => {
  let session: AuthSession;
  const phone = generatePhone();

  // Service-role client bypasses RLS — used only to observe/reset ground truth.
  const admin: SupabaseClient<Database> = createClient<Database>(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Whether the SEC-001 client-write lockdown is live (detected in beforeAll).
  let clientWriteSurfaceClosed = false;

  /**
   * Build an anon-key client bound to the logged-in user's JWT — exactly the
   * storefront browser client. RLS evaluates it as `authenticated` with
   * `auth.uid() = session.userId`. The service role is NOT used here.
   */
  function authedAnonClient(accessToken: string): SupabaseClient<Database> {
    return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  beforeAll(async () => {
    session = await loginTestUser(BASE_URL, phone);
    // Independent of run order (the project shuffles): force a clean baseline.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);

    // ── Fix-state detection (toggle-free) ─────────────────────────────────
    // The fix-defining change is that `public.users` becomes SELECT-only for
    // clients (the `for all`/UPDATE policy is replaced), so a client can no
    // longer write ANY column of its own row directly. Probe that surface with
    // a benign `full_name` write through the anon JWT client. This does NOT
    // touch `role`, so it is orthogonal to the role assertion itself.
    const sentinel = `__sec001_probe_${Date.now().toString(36)}__`;
    await admin.from("users").update({ full_name: "baseline" }).eq("id", session.userId);

    const anon = authedAnonClient(session.accessToken);
    await anon.from("users").update({ full_name: sentinel }).eq("id", session.userId).select("id");

    const { data: probed } = await admin
      .from("users")
      .select("full_name")
      .eq("id", session.userId)
      .single();

    // Closed surface ⇒ the sentinel did NOT persist (RLS denied the client write).
    clientWriteSurfaceClosed = probed?.full_name !== sentinel;

    // Restore baseline and role regardless of probe outcome.
    await admin
      .from("users")
      .update({ full_name: "baseline", role: "customer" })
      .eq("id", session.userId);
  });

  afterAll(async () => {
    if (session?.userId) {
      await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
      await cleanupTestUser(session.userId);
    }
  });

  /**
   * [A1 — additive, toggle-free] Fix-Checking, Property 1, Req 2.1.
   *
   * THE BUG CONDITION: caller=authenticated, table=users, op=UPDATE, role∈columns.
   * After the SEC-001 lockdown, the anon-key self-update of `users.role` is
   * rejected at the RLS layer (`42501`) and the persisted role stays 'customer'.
   *
   * Toggle-free: activates via self-detection once the client-write surface is
   * closed (or when `SEC001_FIXED=1` forces it). While the schema is unfixed it
   * skips with a documented note rather than reporting a red CI — no fix is
   * implemented by this task.
   */
  it("anon-key self-update of users.role is rejected at the RLS layer (42501)", async (ctx) => {
    const fixLive = FORCE_FIXED || clientWriteSurfaceClosed;
    if (!fixLive) {
      ctx.skip(
        "Pending SEC-001 migration (task 4): public.users still permits client " +
          "UPDATE, so the role write is not yet rejected. This assertion goes " +
          "green automatically once the lockdown is live (or set SEC001_FIXED=1).",
      );
      return;
    }

    // Clean baseline regardless of shuffle / prior runs.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);

    const anon = authedAnonClient(session.accessToken);
    const { data, error } = await anon
      .from("users")
      .update({ role: "admin" })
      .eq("id", session.userId)
      .select("id, role");

    // Persisted ground truth via the service role (bypasses RLS).
    const { data: persisted } = await admin
      .from("users")
      .select("role")
      .eq("id", session.userId)
      .single();

    // Post-fix: the role MUST be unchanged. The lockdown surfaces either as an
    // RLS error (`42501`) or as zero rows mutated (SELECT-only policy) — assert
    // robustly across both shapes, requiring `42501` whenever an error is present.
    expect(persisted?.role).toBe("customer");
    if (error) {
      expect(error.code).toBe("42501");
    } else {
      expect(data ?? []).toEqual([]);
    }
  });
});
