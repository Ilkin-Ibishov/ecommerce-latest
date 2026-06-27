import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/**
 * SEC-001 / SEC-008 — Preservation baseline (¬C behavior that MUST NOT change).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    3 (preservation baseline) — re-run by task 6.2 (post-fix preservation)
 * Design:  Property 8 — Preservation: non-buggy inputs produce the same result.
 * Requirements: 3.1 (service-role + profile + signup unchanged), 3.8 (legit profile edit persists).
 *
 * ── Why these tests have NO fixed/unfixed toggle ──────────────────────────
 * Unlike the SEC-001 *exploration* test (`sec001-role-escalation.exploration.test.ts`,
 * which flips its expectation with SEC001_FIXED), preservation behavior is
 * INVARIANT: every assertion here MUST PASS on the current/unfixed code AND
 * MUST STILL PASS after the SEC-001 migration + SEC-008 hardening land. There is
 * nothing to flip — `¬C` inputs are unaffected by the fix by definition.
 *
 * These are RLS-level integration tests for the CI `integration-e2e` job
 * (Supabase with anon + service-role keys + a running API server). They are a
 * no-op locally unless those keys + server (API_URL / :5000) are present.
 *
 * ── Observed ¬C ground truth (confirmed live via the service role, MCP) ─────
 *   1. Service role bypasses RLS entirely. public.users currently exposes only
 *      `users_own_read` (SELECT, auth.uid()=id) and `users_own_update`
 *      (UPDATE, auth.uid()=id) to CLIENT roles; the service role is subject to
 *      neither. A service-role `update users set role=…` succeeds today and
 *      MUST still succeed after the fix (the planned before-update trigger
 *      explicitly allows the service role — design SEC-001 (c), [3.1]).
 *   2. A service-role `update users set {full_name, default_address}=…`
 *      succeeds today and must remain unchanged [3.1].
 *   3. A legitimate customer profile edit persists. We assert it through the
 *      service-role-backed authenticated endpoint `PATCH /api/profile`
 *      (`requireUser`, id from the token, whitelist {full_name, default_address},
 *      writes via getAdminSupabase()). This is BOTH the path that works today
 *      AND the mandated post-fix path (SEC-008/2.8), so the same assertion stays
 *      green after `LoginModal`/`useProfile` stop writing `users` directly and
 *      after the client-write policy is dropped [3.8].
 *   4. A fresh auth signup creates the `public.users` row via the
 *      `handle_new_user()` `security definer` trigger `on_auth_user_created`
 *      (ON auth.users), which INSERTs `(id, phone, role='customer')
 *      ON CONFLICT (id) DO NOTHING`. SEC-001 only (a) makes `users` SELECT-only
 *      for clients, (b) re-scopes the UPDATE grant, and (c) adds a before-UPDATE
 *      trigger — it touches neither INSERT nor the definer trigger. So signup
 *      MUST keep creating the row. This is the one users-write path NOT covered
 *      by the profile endpoint (Property 8 [3.1]).
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000";

const SUPABASE_URL = process.env.SUPABASE_URL!;

/**
 * Generate profile text that is invariant under `.trim()` and within the
 * endpoint's bounds, so the round-trip assertion holds on BOTH unfixed code
 * (the current endpoint stores the raw body) AND fixed code (the SEC-008
 * `UpdateProfileSchema` trims + bounds: full_name 1..200, default_address 0..500).
 * Stripping surrounding whitespace makes the stored value equal the sent value
 * under either behavior.
 */
function profileText(minLength: number, maxLength: number) {
  return fc
    .string({ minLength, maxLength })
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= Math.max(minLength, 1) && s.length <= maxLength);
}

describe("SEC-001/SEC-008 preservation: ¬C behavior unchanged (Property 8)", () => {
  let session: AuthSession;
  const phone = generatePhone();

  // Service-role client bypasses RLS — the canonical ¬C caller for every finding.
  const admin: SupabaseClient<Database> = createClient<Database>(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  beforeAll(async () => {
    // A fresh signup here also exercises the handle_new_user() definer INSERT,
    // creating the public.users row this suite then reads/updates.
    session = await loginTestUser(BASE_URL, phone);
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
  });

  afterAll(async () => {
    if (session?.userId) {
      await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
      await cleanupTestUser(session.userId);
    }
  });

  /** Authenticated request as the logged-in customer (anon-key JWT carried as a Bearer token). */
  async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
  }

  it("service-role update of users.role persists (bypasses RLS) [3.1]", async () => {
    // ¬C: service role is not 'authenticated' — the bug condition never holds.
    const { error: upErr } = await admin
      .from("users")
      .update({ role: "admin" })
      .eq("id", session.userId)
      .select("id, role");
    expect(upErr).toBeNull();

    const { data: persisted } = await admin
      .from("users")
      .select("role")
      .eq("id", session.userId)
      .single();
    expect(persisted?.role).toBe("admin");

    // Restore ground truth.
    await admin.from("users").update({ role: "customer" }).eq("id", session.userId);
  });

  it("service-role update of profile columns persists [3.1]", async () => {
    const full_name = "Service Role Name";
    const default_address = "Service Role Address 123";

    const { data, error } = await admin
      .from("users")
      .update({ full_name, default_address })
      .eq("id", session.userId)
      .select("full_name, default_address")
      .single();

    expect(error).toBeNull();
    expect(data?.full_name).toBe(full_name);
    expect(data?.default_address).toBe(default_address);
  });

  it("legitimate customer {full_name, default_address} edit via /api/profile persists [3.8]", async () => {
    const full_name = "Aysel Customer";
    const default_address = "Baku, Nizami küç. 10";

    // Reset to a known different value via the service role first.
    await admin
      .from("users")
      .update({ full_name: "stale", default_address: "stale" })
      .eq("id", session.userId);

    const patchRes = await authedFetch("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ full_name, default_address }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as {
      full_name: string | null;
      default_address: string | null;
    };
    expect(patched.full_name).toBe(full_name);
    expect(patched.default_address).toBe(default_address);

    // The edit is durable: a follow-up GET returns the same values.
    const getRes = await authedFetch("/api/profile");
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as {
      full_name: string | null;
      default_address: string | null;
    };
    expect(fetched.full_name).toBe(full_name);
    expect(fetched.default_address).toBe(default_address);

    // Cross-check the persisted ground truth via the service role.
    const { data: persisted } = await admin
      .from("users")
      .select("full_name, default_address")
      .eq("id", session.userId)
      .single();
    expect(persisted?.full_name).toBe(full_name);
    expect(persisted?.default_address).toBe(default_address);
  });

  it(
    "property: any valid {full_name, default_address} edit round-trips through /api/profile [3.8]",
    async () => {
      // Property 8 (Preservation): for all legitimate profile inputs (¬C), the
      // authenticated edit is accepted and persisted EXACTLY. Bounded numRuns
      // keeps the live round-trips within the integration timeout.
      await fc.assert(
        fc.asyncProperty(
          profileText(1, 80),
          profileText(0, 120),
          async (full_name, default_address) => {
            const res = await authedFetch("/api/profile", {
              method: "PATCH",
              body: JSON.stringify({ full_name, default_address }),
            });
            expect(res.status).toBe(200);

            const get = await authedFetch("/api/profile");
            expect(get.status).toBe(200);
            const profile = (await get.json()) as {
              full_name: string | null;
              default_address: string | null;
            };
            expect(profile.full_name).toBe(full_name);
            expect(profile.default_address).toBe(default_address);
          },
        ),
        { numRuns: 5 },
      );
    },
    60_000,
  );

  it("fresh auth signup creates the public.users row via handle_new_user() definer trigger [3.1]", async () => {
    // The one users-write path NOT covered by the profile endpoint: the INSERT
    // performed by the security-definer trigger on signup. SEC-001 does not touch
    // INSERT or the definer trigger, so this MUST keep working after the fix.
    const freshPhone = generatePhone();
    const fresh = await loginTestUser(BASE_URL, freshPhone);

    try {
      const { data: row, error } = await admin
        .from("users")
        .select("id, phone, role")
        .eq("id", fresh.userId)
        .single();

      expect(error).toBeNull();
      expect(row?.id).toBe(fresh.userId);
      // handle_new_user() defaults role to 'customer' on the INSERT path.
      expect(row?.role).toBe("customer");
    } finally {
      await cleanupTestUser(fresh.userId);
    }
  });
});
