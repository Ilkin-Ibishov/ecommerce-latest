import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/**
 * SEC-005 + control-plane deny-by-default (SEC-007) — RLS-level integration suite
 * (CI `integration-e2e`).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    23 — "RLS-level integration tests for SEC-005 + control-plane
 *          deny-by-default (CI integration-e2e)"
 * Design:  Property 5 (recursion-safe admin policies via public.is_admin(),
 *            admin/non-admin access decisions preserved),
 *          Property 7 (control-plane deny-by-default),
 *          Property 8 (Preservation: ¬C inputs unchanged).
 * Requirements: 2.5, 2.7, 3.5, 3.7.
 *
 * These are RLS-level integration tests (the *policy* / the migration *is* the
 * assertion). They run in the CI `integration-e2e` job (Supabase with anon +
 * service-role keys + a running API server for the login leg) and are a no-op
 * locally unless those keys + server are present. They live in the
 * `api-integration` vitest project and follow the established conventions:
 * `loginTestUser` / `cleanupTestUser` / `generatePhone`, a service-role client
 * plus a JWT-bound anon-key client, and `afterAll` cleanup of every throwaway
 * user / row written through the anon/service clients.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TASK 23 COVERAGE MATRIX — what is NEW here vs what is owned elsewhere (NO DUP)
 * ─────────────────────────────────────────────────────────────────────────────
 * Per agent-behaviors rule #5 (no duplicate / clobbering coverage), this file
 * deliberately does NOT re-implement assertions already owned by sibling files.
 *
 *   [OWNED — NOT re-asserted here] SEC-005 "no 42P17" refutation invariant
 *     → Owned by `sec005-007-p2.exploration.test.ts` (task 17), which asserts a
 *       direct authenticated `select users`/`audit_log` raises NO `42P17` as an
 *       INVARIANT (true on unfixed AND fixed code). That refutation is the
 *       task-17 file's job; re-asserting it here would duplicate it, so this
 *       file references it instead.
 *
 *   [OWNED — NOT re-asserted here] SEC-006 fail-fast + SEC-007 vercel.json
 *     credential absence (Property 6 / Property 7 bundle leg)
 *     → Owned by the task-17 exploration file (P2_FIXED toggle) and the task-22
 *       unit/property file. Not an RLS/live concern, so out of scope here.
 *
 *   [NEW here] SEC-005 — `public.is_admin()` returns true/false correctly LIVE,
 *     and admin/non-admin access decisions on `audit_log` are PRESERVED
 *     (Fix-Checking + Preservation, Property 5 [3.5]). The exploration file only
 *     proves the *non-admin deny* leg (no rows, no recursion); this file adds the
 *     genuinely-new *admin grant* leg via a service-role-seeded sentinel row and
 *     the live `is_admin()` boolean under both roles.
 *
 *   [NEW here] SEC-005 — structural fix-state ground truth: the migration declares
 *     `public.is_admin()` `security definer stable` and rewrites the LIVE in-scope
 *     policies to `public.is_admin()`. This is the integration suite's own
 *     fix-state detector (different role from task 22's standalone unit assertion);
 *     kept minimal and cross-referenced to avoid clobbering task 22.
 *
 *   [NEW here] SEC-007 — control-plane deny-by-default: the assertion migration
 *     `009_assert_deny_by_default.sql` is present + structurally correct, AND
 *     (when a live control-plane connection is available to the harness) an anon
 *     `select stores` returns `[]` (Fix-Checking + Preservation, Property 7 [3.7]).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LIVE GROUND TRUTH (confirmed via Supabase MCP, service role, at authoring time)
 * ─────────────────────────────────────────────────────────────────────────────
 *   • `public.is_admin()` does NOT yet exist (task 18 unshipped). pg_proc lookup
 *     `is_admin_exists = false` → the SEC-005 live + structural blocks self-skip
 *     until the migration lands. NO FIX is implemented by this task.
 *   • The LIVE inline-`users`-subquery policies (the task-18 rewrite targets) are:
 *       - `audit_admin_read`  ON public.audit_log (SELECT)
 *       - `Pages: admin all`  ON public.pages (ALL)
 *     The design-assumed `"Admins: all users"` ON public.users does NOT exist
 *     live (public.users has only `users_own_read` / `users_own_update`, both
 *     non-recursive). This file targets the ACTUAL live names.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEST-FIRST CONTRACT (no fix is implemented by this task)
 * ─────────────────────────────────────────────────────────────────────────────
 * The SEC-005 Fix-Checking assertions describe POST-FIX state (is_admin() exists;
 * policies rewritten). On the current UNFIXED schema none of that exists, so an
 * unconditional assertion would make the `integration-e2e` job RED on every push
 * until tasks 18 / 20.2 land. To honor the test-first contract WITHOUT a red CI in
 * the interim, each Fix-Checking block self-detects whether its fix-defining change
 * is live (the `is_admin()` RPC resolves / the migration file exists) and either:
 *   • asserts the post-fix behavior once the change is live (goes green in CI), or
 *   • skips with a documented "pending migration" note while unfixed.
 * `P2_FIXED=1` is honored as an optional override that forces the SEC-005 checks.
 * The Preservation legs (access decisions on `audit_log`; control-plane anon read)
 * are INVARIANTS and are not gated — they hold on both unfixed and fixed code.
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000";

// Optional override mirroring the task-17 file's toggle. Primary gating is
// per-finding self-detection (below), NOT this var.
const FORCE_FIXED = process.env.P2_FIXED === "1";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

/** Service-role client bypasses RLS — used to observe ground truth, promote/demote roles, seed + clean up. */
const admin: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** A JWT-bound anon-key client — RLS evaluates it as `authenticated` (auth.uid() = the user). */
function authedAnonClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Untyped anon-key client used ONLY to call the `public.is_admin()` RPC. The
 * helper is created by task 18 and is not in the generated `Database` type until
 * `@workspace/supabase-types` is regenerated, so it is invoked off an untyped
 * client to keep the suite typechecking before the fix lands.
 */
function untypedAnonClient(accessToken?: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Lightweight probe so server-dependent legs self-skip when no API server is running. */
async function apiServerReachable(): Promise<boolean> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2_000);
    const res = await fetch(`${BASE_URL}/api/healthz`, { signal: ac.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Detect whether the SEC-005 `public.is_admin()` helper is live. Before task 18
 * lands, PostgREST returns a "function not found" error; once it exists the call
 * resolves (returning `false` for a null `auth.uid()` under the anon role).
 */
async function isAdminHelperLive(): Promise<boolean> {
  const { error } = await untypedAnonClient().rpc("is_admin");
  return !error;
}

// ───────────────────────────────────────────────────────────────────────────
// SEC-005 — public.is_admin() + admin/non-admin access decisions (Property 5)
//   NEW coverage: the admin-GRANT leg + the live is_admin() boolean. The
//   non-admin "no 42P17 / no rows" refutation is owned by the task-17 file.
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-005 RLS integration (task 23): public.is_admin() + access decisions (Property 5 [3.5])", () => {
  let serverUp = false;
  let session: AuthSession | null = null;
  let fixLive = false;
  const phone = generatePhone();
  const auditSentinelIds = new Set<string>();

  beforeAll(async () => {
    serverUp = await apiServerReachable();
    if (!serverUp) return;
    try {
      session = await loginTestUser(BASE_URL, phone);
    } catch {
      session = null;
      return;
    }
    // Independent of run order (the project shuffles): force a clean baseline role.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
    fixLive = FORCE_FIXED || (await isAdminHelperLive());
  });

  afterAll(async () => {
    // Remove seeded audit rows BEFORE the user is deleted (audit_log.actor_id →
    // public.users.id ON DELETE SET NULL; explicit cleanup keeps the table tidy).
    if (auditSentinelIds.size > 0) {
      await admin.from("audit_log").delete().in("id", Array.from(auditSentinelIds));
    }
    if (session?.userId) {
      await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
      await cleanupTestUser(session.userId);
    }
  });

  /**
   * [Fix-Checking + Preservation] Property 5, Req 2.5 / 3.5.
   * `public.is_admin()` resolves the caller's admin status from `users` by
   * `auth.uid()` (security-definer, recursion-safe). It returns false for a
   * non-admin and true once the SAME caller is promoted via the service role —
   * the access-decision invariant the policy rewrite must preserve.
   *
   * Self-detecting: activates once `is_admin()` is live (or P2_FIXED=1); skips
   * with a documented note while task 18 is unshipped — never a red CI.
   */
  it("is_admin() returns false for a non-admin caller and true once promoted", async (ctx) => {
    if (!serverUp || !session) {
      ctx.skip(`API server not reachable at ${BASE_URL} (or no login available); runs in CI integration-e2e.`);
      return;
    }
    if (!fixLive) {
      ctx.skip(
        "Pending SEC-005 migration (task 18): public.is_admin() does not exist yet. " +
          "This assertion goes green automatically once the helper lands (or set P2_FIXED=1).",
      );
      return;
    }

    // Non-admin baseline → is_admin() is false.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
    const asCustomer = untypedAnonClient(session.accessToken);
    const { data: notAdmin, error: e1 } = await asCustomer.rpc("is_admin");
    expect(e1).toBeNull();
    expect(notAdmin).toBe(false);

    // Promote via the service role (¬C: bypasses RLS + the role-immutability
    // trigger). is_admin() reads the `users` table by auth.uid(), so the new role
    // is reflected even though the JWT was minted while the caller was a customer.
    await admin.from("users").update({ role: "admin" }).eq("id", session.userId);
    const asAdmin = untypedAnonClient(session.accessToken);
    const { data: isAdmin, error: e2 } = await asAdmin.rpc("is_admin");
    expect(e2).toBeNull();
    expect(isAdmin).toBe(true);

    // Restore baseline.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
  });

  /**
   * [Preservation — INVARIANT] Property 5 / Property 8, Req 3.5.
   * The admin-read policy on `audit_log` (`audit_admin_read` today; rewritten to
   * `public.is_admin()` by task 18) must keep the SAME access decision: a
   * non-admin sees no rows; an admin sees the row. Proven with a service-role-
   * seeded sentinel so the admin-GRANT leg is genuinely exercised (the task-17
   * file only proves the non-admin deny leg). Not gated on the fix — the access
   * decision is preserved on BOTH unfixed and fixed code.
   */
  it("audit_log RLS preserves admin/non-admin access decisions (seeded sentinel)", async (ctx) => {
    if (!serverUp || !session) {
      ctx.skip(`API server not reachable at ${BASE_URL} (or no login available); runs in CI integration-e2e.`);
      return;
    }

    // Seed a uniquely-identifiable audit row via the service role (bypasses RLS).
    const marker = `sec005-task23-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: seeded, error: seedErr } = await admin
      .from("audit_log")
      .insert({ action: marker, entity: "sec005_probe", actor_id: session.userId })
      .select("id")
      .single();
    if (seedErr || !seeded) throw new Error(`[SEC-005] audit_log seed failed: ${seedErr?.message}`);
    auditSentinelIds.add(seeded.id);

    // Non-admin: RLS denies → cannot see the seeded row.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
    const asCustomer = authedAnonClient(session.accessToken);
    const { data: customerView, error: ce } = await asCustomer
      .from("audit_log")
      .select("id")
      .eq("id", seeded.id);
    expect(ce).toBeNull();
    expect(customerView ?? []).toEqual([]);

    // Admin: the admin-read policy grants → sees the seeded row.
    await admin.from("users").update({ role: "admin" }).eq("id", session.userId);
    const asAdmin = authedAnonClient(session.accessToken);
    const { data: adminView, error: ae } = await asAdmin
      .from("audit_log")
      .select("id")
      .eq("id", seeded.id);
    expect(ae).toBeNull();
    expect((adminView ?? []).map((r) => r.id)).toContain(seeded.id);

    // Restore baseline.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SEC-005 — structural fix-state ground truth (Fix-Checking, Property 5 [3.5])
//   Asserts is_admin() is `security definer stable` and the LIVE in-scope
//   policies are rewritten to public.is_admin(). This is the integration suite's
//   own fix-state detector; the standalone Property-5 structural unit is owned by
//   task 22 (cross-referenced — kept minimal here to avoid clobbering it). The
//   "security definer stable" / pg_policies ground truth is not reachable via
//   supabase-js in CI, so it is verified against the migration file (the option
//   the task allows) and was confirmed live via Supabase MCP at authoring time
//   (is_admin absent pre-fix).
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-005 migration rewrites in-scope policies to public.is_admin() (Fix-Checking, Property 5 [3.5])", () => {
  const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../../supabase/migrations");
  const CANONICAL = "20240105_sec005_is_admin_helper_and_policies.sql";

  function findSec005Migration(): { file: string; sqlNorm: string } | null {
    if (!existsSync(MIGRATIONS_DIR)) return null;
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const chosen =
      files.find((f) => f === CANONICAL) ??
      files.find((f) => /sec005/i.test(f) && /(is_admin|admin)/i.test(f));
    if (!chosen) return null;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, chosen), "utf-8");
    return { file: chosen, sqlNorm: sql.replace(/\s+/g, " ").toLowerCase() };
  }

  it("declares public.is_admin() as security definer + stable", (ctx) => {
    const migration = findSec005Migration();
    if (!migration) {
      ctx.skip(
        `SEC-005 migration not found in supabase/migrations (looked for ${CANONICAL} ` +
          "or a *sec005*.sql file) — pending task 18, the expected test-first state.",
      );
      return;
    }
    const { sqlNorm } = migration;
    // The helper is created and keys off the admin role of the current user.
    expect(/create or replace function public\.is_admin\(\)/.test(sqlNorm)).toBe(true);
    // security definer + stable (recursion-safe, side-effect-free).
    expect(sqlNorm).toContain("security definer");
    expect(sqlNorm).toContain("stable");
  });

  it("rewrites the LIVE in-scope policies (audit_admin_read + 'Pages: admin all') to public.is_admin()", (ctx) => {
    const migration = findSec005Migration();
    if (!migration) {
      ctx.skip(`SEC-005 migration not found — pending task 18 (looked for ${CANONICAL}).`);
      return;
    }
    const { sqlNorm } = migration;
    // The rewrite calls the helper rather than an inline `users` subquery.
    expect(sqlNorm).toContain("public.is_admin()");
    // The two ACTUAL live inline-subquery policy names are the rewrite targets
    // (the design-assumed "Admins: all users" on public.users does NOT exist live).
    expect(sqlNorm).toContain("audit_admin_read");
    expect(sqlNorm).toContain("pages: admin all");
    // No rewritten in-scope policy reintroduces an inline `from users` subquery.
    expect(/create policy[^;]*from\s+users\b/.test(sqlNorm)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SEC-007 — control-plane deny-by-default (Property 7 [3.7])
//   (a) Structural: the assertion migration 009_assert_deny_by_default.sql is
//       present + structurally correct (raises on RLS-disabled / policy-present).
//   (b) Live (when a control-plane connection is available to the harness): anon
//       `select stores` returns [] — deny-by-default holds. The CI integration-e2e
//       job only provisions the STORE-DB secrets, so the live leg self-skips there
//       and runs only where CONTROL_PLANE_SUPABASE_* are present (documented).
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-007 control-plane deny-by-default (task 23, Property 7 [3.7])", () => {
  const CP_MIGRATIONS_DIR = resolve(
    import.meta.dirname,
    "../../../supabase/control-plane/migrations",
  );
  const CANONICAL = "009_assert_deny_by_default.sql";

  function findDenyByDefaultMigration(): { file: string; sqlNorm: string } | null {
    if (!existsSync(CP_MIGRATIONS_DIR)) return null;
    const files = readdirSync(CP_MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const chosen =
      files.find((f) => f === CANONICAL) ??
      files.find((f) => /assert/i.test(f) && /deny/i.test(f));
    if (!chosen) return null;
    const sql = readFileSync(resolve(CP_MIGRATIONS_DIR, chosen), "utf-8");
    return { file: chosen, sqlNorm: sql.replace(/\s+/g, " ").toLowerCase() };
  }

  it("009_assert_deny_by_default.sql is present and structurally correct (Fix-Checking)", (ctx) => {
    const migration = findDenyByDefaultMigration();
    if (!migration) {
      ctx.skip(
        `Control-plane deny-by-default migration not found in supabase/control-plane/migrations ` +
          `(looked for ${CANONICAL} or a *assert*deny*.sql file) — pending task 20.2, the ` +
          "expected test-first state.",
      );
      return;
    }
    const { sqlNorm } = migration;
    // It is an anonymous DO block that performs the assertion.
    expect(/do\s+\$\$/.test(sqlNorm) || sqlNorm.includes("do $$")).toBe(true);
    // It raises if the deny-by-default contract is violated.
    expect(/raise exception/.test(sqlNorm)).toBe(true);
    // It inspects RLS-enabled state (relrowsecurity / rowsecurity) for `public` tables.
    expect(/relrowsecurity|rowsecurity/.test(sqlNorm)).toBe(true);
    // ...and the presence of any policy on the `public` schema (pg_policies / pg_policy).
    expect(/pg_policies|pg_policy\b/.test(sqlNorm)).toBe(true);
  });

  it("live control-plane anon SELECT on stores returns no rows (deny-by-default, Preservation)", async (ctx) => {
    const cpUrl = process.env.CONTROL_PLANE_SUPABASE_URL;
    const cpAnonKey = process.env.CONTROL_PLANE_SUPABASE_ANON_KEY;
    if (!cpUrl || !cpAnonKey) {
      ctx.skip(
        "Control-plane connection not available to this harness " +
          "(CONTROL_PLANE_SUPABASE_URL / CONTROL_PLANE_SUPABASE_ANON_KEY unset). The CI " +
          "integration-e2e job only provisions the store-DB secrets, so this live leg runs " +
          "only where the control-plane anon credential is present; structural coverage of " +
          "deny-by-default is provided by the 009_assert_deny_by_default.sql assertion above.",
      );
      return;
    }

    // A plain anon client against the SEPARATE control-plane project. With RLS
    // enabled and zero policies, anon `select` is filtered to zero rows (no error).
    const cpAnon = createClient(cpUrl, cpAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await cpAnon.from("stores").select("id");

    // Deny-by-default: no rows returned to anon, and no privileged data leaks.
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
