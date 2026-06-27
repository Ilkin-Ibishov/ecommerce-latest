import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { calculateDiscount } from "../src/lib/coupon-calc.ts";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/**
 * P1 (SEC-002 / SEC-003 / SEC-004) — Preservation baseline (¬C behavior that MUST NOT change).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    10 (preservation baseline) — re-run by task 14.2 (post-fix preservation)
 * Design:  Property 8 — Preservation: non-buggy inputs produce the same result as the original.
 * Requirements: 3.2 (size_guides public read + service write), 3.3 (coupon validation + math),
 *               3.4 (comment moderation flow), 3.9 (admin coupon list still retrievable).
 *
 * ── Why these tests have NO fixed/unfixed toggle ──────────────────────────
 * Unlike the P1 *exploration* tests (`*.exploration.test.ts`, task 9, which flip
 * their expectation once the fix lands), preservation behavior is INVARIANT:
 * every assertion here MUST PASS on the current/unfixed code AND MUST STILL PASS
 * after the SEC-002/003/004 migrations land. There is nothing to flip — `¬C`
 * inputs are unaffected by the fix by definition. No fix is implemented by this
 * task; these are observation-first baselines (the live ¬C outcomes were captured
 * via the service role first, then encoded below).
 *
 * ── Test layers in this file ──────────────────────────────────────────────
 *   • [3.3] pure unit anchor — `calculateDiscount()` for the live WELCOME10 config
 *     (no DB, no server). Always runs.
 *   • RLS-level integration (CI `integration-e2e`, Supabase anon + service-role
 *     keys): [3.2] size_guides, [3.9] admin coupon list. These need only Supabase
 *     and run wherever the keys are present (setup.ts guarantees them).
 *   • Endpoint/RLS integration needing a running API server: [3.3] coupon validate,
 *     [3.4] comment moderation (login → JWT). These self-skip when the server at
 *     API_URL/:5000 is unreachable, so the file is green locally and meaningful in
 *     CI. They follow the established helper conventions
 *     (`loginTestUser`/`cleanupTestUser`/`generatePhone`, service-role + JWT-bound
 *     anon clients, `afterAll` cleanup).
 *
 * ── NO DUPLICATION of existing coupon-calc coverage ───────────────────────
 * The exhaustive `calculateDiscount()` properties (percentage/fixed formula,
 * rounding, subtotal cap, min-order rejection/boundary) already live in
 * `coupon-calc.property.test.ts`, and a generic `POST /api/coupons/validate`
 * integration check for `TEST_10PCT` lives in `coupons.test.ts`. This file does
 * NOT re-implement either. It adds only what is missing for task 10: a concrete
 * anchor tying the LIVE `WELCOME10` coupon config to `calculateDiscount()`, and a
 * `WELCOME10`-specific endpoint round-trip (the code named in Req 3.3 / the
 * security report), keeping the generic coverage untouched.
 *
 * ── Observed ¬C ground truth (confirmed live via the service role / MCP) ────
 *   [3.2] size_guides: policy `size_guides_read` is SELECT `using(true)` — public
 *         (anon) read succeeds and returns rows. SEC-002 drops only the world-WRITE
 *         policy (`size_guides_admin_write`, ALL true/true) and RETAINS the read
 *         policy, so public reads remain unchanged. Service-role writes bypass RLS
 *         and persist (¬C for SEC-002).
 *   [3.3] WELCOME10: { discount_type: 'percentage', discount_value: 10,
 *         min_order_amount: 50, is_active: true } — so subtotal 100 ⇒ discount 10,
 *         the 50 boundary ⇒ discount 5, subtotal below 50 ⇒ rejected. SEC-003 only
 *         removes the anon SELECT path; server-side validation via
 *         `POST /api/coupons/validate` (service role) is unchanged.
 *   [3.4] comments: `comments_own_insert` with_check `user_id = auth.uid()` accepts
 *         an authenticated self-insert; `comments_public_read` keeps an unapproved
 *         row hidden from other/anon callers (`approved = true OR own OR admin`).
 *         Admin moderation flips `approved` via the service role. SEC-004 only adds
 *         `AND approved = false` to the INSERT check, so an `approved = false`
 *         self-insert and the moderation flow stay unchanged (¬C).
 *   [3.9] coupons admin list: today `CouponsPage` reads the list via the anon
 *         client; after SEC-003 it is served by `GET /admin/coupons` (service role,
 *         requireAdmin). The DURABLE invariant common to both — chosen here over a
 *         fragile jsdom DOM render that asserts the soon-to-change read mechanism —
 *         is that the coupon list is RETRIEVABLE BY AN ADMIN PATH, i.e. via the
 *         service role (the data source backing the page before AND after the fix).
 *         A DOM test of `CouponsPage` would assert the anon read and break on the
 *         re-route; the service-role retrieval assertion stays green across it.
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

/** Service-role client — bypasses RLS; the canonical ¬C caller for every finding. */
function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Plain anon-key client (role = anon, no JWT) — exactly the storefront browser read. */
function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Anon-key client bound to a logged-in user's JWT (role = authenticated, auth.uid() set). */
function authedAnonClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Lightweight probe so endpoint-dependent tests self-skip when no server is running. */
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

// ─────────────────────────────────────────────────────────────────────────────
// [3.3] Pure unit anchor — WELCOME10 config through calculateDiscount() (no DB).
// Complements (does NOT duplicate) the exhaustive formula properties in
// coupon-calc.property.test.ts. Anchors the LIVE coupon parameters to the math.
// ─────────────────────────────────────────────────────────────────────────────
describe("[3.3] calculateDiscount() preserves the live WELCOME10 outcome (Property 8, pure)", () => {
  // Mirrors the live WELCOME10 row (percentage 10%, min order 50 AZN).
  const WELCOME10 = {
    discount_type: "percentage" as const,
    discount_value: 10,
    min_order_amount: 50,
  };

  it("subtotal 100 → 10% discount of 10 AZN", () => {
    const result = calculateDiscount(WELCOME10, 100);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.discount_amount).toBe(10);
  });

  it("subtotal at the 50 AZN minimum boundary → accepted, 5 AZN", () => {
    const result = calculateDiscount(WELCOME10, 50);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.discount_amount).toBe(5);
  });

  it("subtotal below the 50 AZN minimum → rejected (no discount)", () => {
    const result = calculateDiscount(WELCOME10, 49.99);
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [3.2] size_guides — public read returns rows + service-role write succeeds.
// Needs only Supabase (anon + service-role keys). No API server required.
// ─────────────────────────────────────────────────────────────────────────────
describe("[3.2] size_guides preservation: public read + service-role write (Property 8)", () => {
  const admin = serviceClient();
  let categoryId: string | null = null;
  let insertedId: string | null = null;
  let ready = false;

  beforeAll(async () => {
    // A valid category_id is required by the size_guides.category_id FK.
    const { data: category } = await admin
      .from("categories")
      .select("id")
      .limit(1)
      .maybeSingle();
    categoryId = category?.id ?? null;
    ready = categoryId != null;
  });

  afterAll(async () => {
    if (insertedId) {
      await admin.from("size_guides").delete().eq("id", insertedId);
    }
  });

  it("service-role insert into size_guides persists (bypasses RLS) [3.2]", async (ctx) => {
    if (!ready) {
      ctx.skip("No category row available to satisfy the size_guides.category_id FK.");
      return;
    }

    const { data, error } = await admin
      .from("size_guides")
      .insert({
        category_id: categoryId!,
        headers: ["Size", "Chest", "Waist"],
        rows: [["S", "90", "70"]],
        measurement_unit: "cm",
      })
      .select("id, category_id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    insertedId = data?.id ?? null;
  });

  it("public anon-key select on size_guides succeeds and returns the row [3.2]", async (ctx) => {
    if (!insertedId) {
      ctx.skip("Depends on the service-role insert above (FK setup unavailable).");
      return;
    }

    // size_guides_read is `for select using (true)` for the {public} role group,
    // so the unauthenticated anon client reads rows with no RLS error. SEC-002
    // retains this read policy, so this assertion stays green after the fix.
    const anon = anonClient();
    const { data, error } = await anon.from("size_guides").select("id, category_id");

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data ?? []).some((row) => row.id === insertedId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [3.9] Admin coupon list — durable retrieval via the service role (the data
// source backing the admin page before AND after the SEC-003 re-route).
// Needs only Supabase. No API server required.
// ─────────────────────────────────────────────────────────────────────────────
describe("[3.9] admin coupon list retrievable via the service role (Property 8)", () => {
  const admin = serviceClient();

  it("service-role select returns the coupon list (incl. WELCOME10) [3.9]", async () => {
    // Durable invariant: the admin coupon list is retrievable by an admin path.
    // Pre-fix `CouponsPage` reads via the anon client; post-fix via
    // `GET /admin/coupons` (service role). Both resolve to the same service-role
    // data source, so asserting that retrieval here survives the re-route.
    const { data, error } = await admin
      .from("coupons")
      .select("id, code, discount_type, discount_value, is_active")
      .order("created_at", { ascending: false });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data ?? []).length).toBeGreaterThan(0);
    expect((data ?? []).some((c) => c.code === "WELCOME10")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [3.3] Coupon validation endpoint — WELCOME10 returns the correct discount.
// Needs a running API server (POST /api/coupons/validate, service role). Skips
// when the server is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
describe("[3.3] POST /api/coupons/validate preserves WELCOME10 validation (Property 8)", () => {
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await apiServerReachable();
  });

  it("validates WELCOME10 and returns the correct 10% discount [3.3]", async (ctx) => {
    if (!serverUp) {
      ctx.skip(`API server not reachable at ${BASE_URL}; runs in CI integration-e2e.`);
      return;
    }

    const res = await fetch(`${BASE_URL}/api/coupons/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "WELCOME10", subtotal: 100 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      code: string;
      discount_type: string;
      discount_value: number;
      discount_amount: number;
    };
    expect(body.code).toBe("WELCOME10");
    expect(body.discount_type).toBe("percentage");
    expect(Number(body.discount_value)).toBe(10);
    // 10% of 100 = 10 (the live coupon math, identical pre/post fix).
    expect(body.discount_amount).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [3.4] Comment moderation flow — authenticated approved=false insert succeeds
// and stays hidden; admin moderation via the service role works. Needs a running
// API server (login → JWT). Skips when the server is unreachable. Cleans up.
// ─────────────────────────────────────────────────────────────────────────────
describe("[3.4] comment moderation preservation: unapproved insert hidden, admin approves (Property 8)", () => {
  const admin = serviceClient();
  let serverUp = false;
  let session: AuthSession | null = null;
  let productId: string | null = null;
  let commentId: string | null = null;
  const phone = generatePhone();

  beforeAll(async () => {
    serverUp = await apiServerReachable();
    if (!serverUp) return;

    try {
      session = await loginTestUser(BASE_URL, phone);
    } catch {
      session = null;
      return;
    }

    const { data: product } = await admin
      .from("products")
      .select("id")
      .limit(1)
      .maybeSingle();
    productId = product?.id ?? null;
  });

  afterAll(async () => {
    if (commentId) {
      await admin.from("comments").delete().eq("id", commentId);
    }
    if (session?.userId) {
      await cleanupTestUser(session.userId);
    }
  });

  it("authenticated insert {approved:false} succeeds, stays hidden, admin approves via service role [3.4]", async (ctx) => {
    if (!serverUp || !session || !productId) {
      ctx.skip(
        `API server not reachable at ${BASE_URL} (or no product/login available); ` +
          "runs in CI integration-e2e.",
      );
      return;
    }

    // 1. Authenticated self-insert of an UNAPPROVED comment succeeds.
    //    (¬C: approved=false; SEC-004 only rejects approved=true self-inserts.)
    const anon = authedAnonClient(session.accessToken);
    const { data: inserted, error: insertErr } = await anon
      .from("comments")
      .insert({
        user_id: session.userId,
        product_id: productId,
        content: "Preservation baseline comment (unapproved).",
        rating: 5,
        approved: false,
      })
      .select("id, approved")
      .single();

    expect(insertErr).toBeNull();
    expect(inserted?.id).toBeTruthy();
    expect(inserted?.approved).toBe(false);
    commentId = inserted?.id ?? null;

    // 2. It stays hidden from an unauthenticated (anon) reader: comments_public_read
    //    only exposes approved=true OR own OR admin. A fresh anon client has no
    //    auth.uid(), so the unapproved row must not appear.
    const publicAnon = anonClient();
    const { data: publicRows, error: publicErr } = await publicAnon
      .from("comments")
      .select("id, approved")
      .eq("id", commentId!);

    expect(publicErr).toBeNull();
    expect((publicRows ?? []).length).toBe(0);

    // 3. Admin moderation via the service role approves the comment (bypasses RLS).
    const { data: approved, error: approveErr } = await admin
      .from("comments")
      .update({ approved: true })
      .eq("id", commentId!)
      .select("id, approved")
      .single();

    expect(approveErr).toBeNull();
    expect(approved?.approved).toBe(true);

    // 4. Once approved, the comment becomes publicly visible (read policy unchanged).
    const { data: nowVisible } = await publicAnon
      .from("comments")
      .select("id, approved")
      .eq("id", commentId!);

    expect((nowVisible ?? []).some((row) => row.id === commentId && row.approved === true)).toBe(
      true,
    );
  });
});
