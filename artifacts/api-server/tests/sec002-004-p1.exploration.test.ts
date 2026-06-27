import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/**
 * SEC-002 / SEC-003 / SEC-004 — P1 data-exposure / world-write defects.
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    9 (exploration) — re-run by task 14.1 (fix-check)
 * Design:  Property 2 (size_guides not client-writable),
 *          Property 3 (coupons not anon-readable),
 *          Property 4 (comment moderation enforced on insert).
 * Requirements: 1.2/1.3/1.4 (current defects), 2.2/2.3/2.4 (expected after fix).
 *
 * ── Bug conditions (from bugfix.md derivations) ───────────────────────────
 *   SEC-002: caller ∈ {anon, authenticated} ∧ table=size_guides ∧ op ∈ {INSERT,UPDATE,DELETE}
 *   SEC-003: caller = anon                   ∧ table=coupons     ∧ op = SELECT
 *   SEC-004: caller = authenticated          ∧ table=comments    ∧ op = INSERT ∧ row.approved = true
 *
 * These are RLS-level integration tests: the *policy* is the assertion. They run
 * in the CI `integration-e2e` job (Supabase with anon + service-role keys and a
 * running API server) and are a no-op locally unless those keys + server are
 * present. They follow the established `api-integration` conventions:
 * `loginTestUser` / `cleanupTestUser` / `generatePhone`, a service-role client
 * plus an anon-key client (JWT-bound where the caller must be `authenticated`),
 * and `afterAll` cleanup of every row written through the anon key.
 *
 * ── Switchable expected outcome (exploration → fix-check) ──────────────────
 * The SAME tests run twice across the bugfix lifecycle (mirrors the SEC-001
 * exploration toggle `SEC001_FIXED`):
 *
 *   • UNFIXED code (task 9, the default):   P1_FIXED unset/"0"
 *       → SEC-002: anon write to `size_guides` is ACCEPTED and PERSISTS (defect).
 *       → SEC-003: anon `select coupons` RETURNS the active codes (defect).
 *       → SEC-004: authenticated insert `{approved:true}` is ACCEPTED (defect).
 *         These capture the counterexamples proving each bug exists.
 *
 *   • FIXED code (task 14.1):               P1_FIXED="1"
 *       → SEC-002: the write is REJECTED (RLS `42501`) / does not persist.
 *       → SEC-003: anon `select coupons` returns `[]`.
 *       → SEC-004: the `{approved:true}` insert is REJECTED (`42501`).
 *
 * Flip the expectation by setting P1_FIXED=1 after the P1 migrations land. No
 * second test file is written (per task 14.1).
 *
 * ── Counterexamples captured on UNFIXED code (live DB confirmed via service role)
 *   SEC-002: policy `size_guides_admin_write` = ALL roles=public USING(true)
 *            WITH CHECK(true) → anon INSERT with a valid category_id persists.
 *   SEC-003: policy `coupons_customer_read` = SELECT USING(is_active = true OR
 *            is_admin) → anon SELECT returns FLAT20, TEST_10PCT, TEST_5AZN,
 *            WELCOME10 with discount values.
 *   SEC-004: policy `comments_own_insert` = INSERT WITH CHECK(user_id =
 *            auth.uid()) — no `approved` constraint → authenticated insert with
 *            approved=true is accepted and published unmoderated.
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000";

// Expected-outcome toggle. Default (unset) = UNFIXED code = bugs are present.
const EXPECT_FIXED = process.env.P1_FIXED === "1";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

/** Seeded active coupon codes that anon must NOT be able to read after the fix. */
const SEEDED_ACTIVE_CODES = ["WELCOME10", "FLAT20", "TEST_10PCT", "TEST_5AZN"];

/** Service-role client bypasses RLS — used to look up FK ids and to clean up. */
const admin: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** A plain anonymous client (no JWT) — RLS evaluates it as the `anon` role. */
function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** An anon-key client bound to a user JWT — RLS evaluates it as `authenticated`. */
function authedAnonClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// SEC-002 — `size_guides` world-writable (Property 2)
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-002 exploration: size_guides world-writable via anon client (Property 2)", () => {
  // `size_guides.category_id` carries a UNIQUE constraint, so each test that
  // creates a row must target a DISTINCT category to avoid collisions.
  let categoryIds: string[] = [];
  // Every row written through the anon key (or seeded for UPDATE/DELETE targets)
  // is tracked and removed via the service role in afterAll.
  const sizeGuideIds = new Set<string>();

  beforeAll(async () => {
    const { data, error } = await admin.from("categories").select("id").limit(3);
    if (error || !data || data.length < 3) {
      throw new Error(`[SEC-002] need >=3 categories for distinct rows: ${error?.message}`);
    }
    categoryIds = data.map((c) => c.id);
  });

  afterAll(async () => {
    if (sizeGuideIds.size > 0) {
      await admin.from("size_guides").delete().in("id", Array.from(sizeGuideIds));
    }
  });

  it("anon INSERT into size_guides with a valid category_id (the world-write)", async () => {
    const anon = anonClient();

    // THE BUG CONDITION: caller=anon, table=size_guides, op=INSERT.
    // A valid category_id is used so the write passes the FK check and ONLY the
    // RLS policy is under test (an invalid FK would fail with 23503 regardless).
    const { data, error } = await anon
      .from("size_guides")
      .insert({ category_id: categoryIds[0], headers: [], rows: [], measurement_unit: "cm" })
      .select("id, category_id");

    if (data?.[0]?.id) sizeGuideIds.add(data[0].id);

    // Ground truth via the service role (bypasses RLS).
    const persistedId = data?.[0]?.id;
    const { data: persisted } = persistedId
      ? await admin.from("size_guides").select("id").eq("id", persistedId).maybeSingle()
      : { data: null };

    if (EXPECT_FIXED) {
      // Fix-check (task 14.1): the write must be REJECTED at the RLS layer.
      expect(persisted).toBeNull();
      expect(error?.code).toBe("42501");
    } else {
      // EXPLORATION (task 9, UNFIXED): the anon write is ACCEPTED and PERSISTS —
      // this is the defect. Counterexample: anon insert(size_guides) returns no
      // error, a row id comes back, and the row exists in the table.
      expect(error).toBeNull();
      expect(persistedId).toBeTruthy();
      expect(persisted?.id).toBe(persistedId);
    }
  });

  it("anon UPDATE of an existing size_guides row", async () => {
    // Seed the target row via the service role (¬C write), then attack via anon.
    const { data: seeded, error: seedErr } = await admin
      .from("size_guides")
      .insert({ category_id: categoryIds[1], headers: [], rows: [], measurement_unit: "cm" })
      .select("id")
      .single();
    if (seedErr || !seeded) throw new Error(`[SEC-002] seed failed: ${seedErr?.message}`);
    sizeGuideIds.add(seeded.id);

    const anon = anonClient();
    const { error } = await anon
      .from("size_guides")
      .update({ measurement_unit: "in" })
      .eq("id", seeded.id)
      .select("id");

    const { data: after } = await admin
      .from("size_guides")
      .select("measurement_unit")
      .eq("id", seeded.id)
      .single();

    if (EXPECT_FIXED) {
      // Fix-check: the update is rejected / has no effect; value stays 'cm'.
      expect(after?.measurement_unit).toBe("cm");
      if (error) expect(error.code).toBe("42501");
    } else {
      // EXPLORATION (UNFIXED): the anon update persists — value becomes 'in'.
      expect(error).toBeNull();
      expect(after?.measurement_unit).toBe("in");
    }
  });

  it("anon DELETE of an existing size_guides row", async () => {
    const { data: seeded, error: seedErr } = await admin
      .from("size_guides")
      .insert({ category_id: categoryIds[2], headers: [], rows: [], measurement_unit: "cm" })
      .select("id")
      .single();
    if (seedErr || !seeded) throw new Error(`[SEC-002] seed failed: ${seedErr?.message}`);
    sizeGuideIds.add(seeded.id);

    const anon = anonClient();
    const { error } = await anon.from("size_guides").delete().eq("id", seeded.id).select("id");

    const { data: after } = await admin
      .from("size_guides")
      .select("id")
      .eq("id", seeded.id)
      .maybeSingle();

    if (EXPECT_FIXED) {
      // Fix-check: the delete is rejected / has no effect; the row still exists.
      expect(after?.id).toBe(seeded.id);
      if (error) expect(error.code).toBe("42501");
    } else {
      // EXPLORATION (UNFIXED): the anon delete persists — the row is gone.
      expect(error).toBeNull();
      expect(after).toBeNull();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SEC-003 — active coupon codes publicly readable (Property 3)
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-003 exploration: coupons anon-readable via anon client (Property 3)", () => {
  it("anon SELECT on coupons returns active codes + discount values", async () => {
    const anon = anonClient();

    // THE BUG CONDITION: caller=anon, table=coupons, op=SELECT.
    const { data, error } = await anon
      .from("coupons")
      .select("code, discount_type, discount_value, min_order_amount, max_uses");

    if (EXPECT_FIXED) {
      // Fix-check (task 14.1): the broad public-read policy is removed, so anon
      // sees no rows. (No error is expected — RLS simply filters to zero rows.)
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    } else {
      // EXPLORATION (task 9, UNFIXED): anon reads every active coupon's code and
      // discount value — this is the defect. Counterexample: the seeded marketing
      // codes are all visible to an unauthenticated client.
      expect(error).toBeNull();
      const codes = (data ?? []).map((c) => c.code);
      for (const code of SEEDED_ACTIVE_CODES) {
        expect(codes).toContain(code);
      }
      // Sensitive discount values are exposed alongside the codes.
      const welcome = (data ?? []).find((c) => c.code === "WELCOME10");
      expect(welcome?.discount_value).toBeTruthy();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SEC-004 — review moderation bypass on comment insert (Property 4)
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-004 exploration: comment moderation bypass via anon client (Property 4)", () => {
  let session: AuthSession;
  const phone = generatePhone();
  let productId: string;
  const commentIds = new Set<string>();

  beforeAll(async () => {
    const { data, error } = await admin.from("products").select("id").limit(1).single();
    if (error || !data) throw new Error(`[SEC-004] could not find a product_id: ${error?.message}`);
    productId = data.id;

    session = await loginTestUser(BASE_URL, phone);
  });

  afterAll(async () => {
    // Remove any comment written through the anon key BEFORE the user is deleted
    // (comments.user_id → public.users.id; cleanupTestUser does not touch comments).
    if (commentIds.size > 0) {
      await admin.from("comments").delete().in("id", Array.from(commentIds));
    }
    if (session?.userId) {
      await admin.from("comments").delete().eq("user_id", session.userId);
      await cleanupTestUser(session.userId);
    }
  });

  it("authenticated INSERT into comments with approved=true (the moderation bypass)", async () => {
    const anon = authedAnonClient(session.accessToken);

    // THE BUG CONDITION: caller=authenticated, table=comments, op=INSERT, approved=true.
    const { data, error } = await anon
      .from("comments")
      .insert({
        user_id: session.userId,
        product_id: productId,
        content: "exploration: self-approved review",
        approved: true,
        rating: 5,
      })
      .select("id, approved");

    if (data?.[0]?.id) commentIds.add(data[0].id);

    // Ground truth via the service role (bypasses RLS).
    const persistedId = data?.[0]?.id;
    const { data: persisted } = persistedId
      ? await admin.from("comments").select("approved").eq("id", persistedId).maybeSingle()
      : { data: null };

    if (EXPECT_FIXED) {
      // Fix-check (task 14.1): the insert policy now requires approved=false, so
      // an approved=true insert is REJECTED and nothing is published.
      expect(persisted).toBeNull();
      expect(error?.code).toBe("42501");
    } else {
      // EXPLORATION (task 9, UNFIXED): the self-approved review is ACCEPTED and
      // published unmoderated — this is the defect. Counterexample: authenticated
      // insert({approved:true}) returns no error and the persisted row is approved.
      expect(error).toBeNull();
      expect(data?.[0]?.approved).toBe(true);
      expect(persisted?.approved).toBe(true);
    }
  });
});
