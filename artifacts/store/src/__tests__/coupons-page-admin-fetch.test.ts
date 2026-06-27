// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import AdminCouponsPage from "@/pages/admin/CouponsPage";

/**
 * SEC-003 — `CouponsPage` reads its list through the admin API (`adminFetch
 * ('/admin/coupons')`) and makes NO direct anon-client Supabase read
 * (behavioral DOM test, jsdom).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    15 (P1 unit/property tests) — TEST-FIRST: written BEFORE task 12.2 lands.
 * Design:  Property 3 / Property 8 [3.9] — once the public coupon-read RLS policy
 *          is dropped (SEC-003), the admin list MUST be served via the
 *          service-role `GET /admin/coupons` endpoint. The page's
 *          `createClient().from("coupons").select("*").order(...)` read is
 *          replaced with `adminFetch(apiUrl("/admin/coupons")).then(r=>r.json())
 *          .then(data => setCoupons(data ?? []))`, and the list must keep
 *          rendering exactly as today.
 * Requirements: 2.3, 2.9, 3.9.
 *
 * ── Why a real DOM render (per agent-behaviors rule #3) ─────────────────────
 * The data source is chosen inside a `useEffect`, so behavior can only be
 * observed by rendering the page and inspecting the DOM + the mocked
 * dependencies — NOT by regex-matching the .tsx source. The store vitest project
 * is node-only by default, so this single file opts into jsdom via the
 * `@vitest-environment jsdom` pragma above (@testing-library/react + jsdom are
 * store devDependencies, added for the DOM tests).
 *
 * ── Test-first expectation ──────────────────────────────────────────────────
 * On UNFIXED code the effect calls `createClient().from("coupons").select(...)`
 * and never calls `adminFetch`, so:
 *   • "renders the list via adminFetch" is RED (adminFetch not called; the
 *     mocked coupon codes never reach the DOM — the empty state shows instead).
 *   • "makes no direct Supabase coupons read" is RED (`from("coupons")` IS
 *     called).
 * After task 12.2 swaps the effect to `adminFetch`, the SAME test turns green
 * with no edit. The render-smoke test passes in both regimes.
 */

const COUPONS = [
  {
    id: "coupon-1",
    code: "WELCOME10",
    description: "Welcome 10%",
    discount_type: "percentage" as const,
    discount_value: 10,
    min_order_amount: null,
    max_uses: null,
    used_count: 3,
    is_active: true,
    expires_at: null,
  },
  {
    id: "coupon-2",
    code: "FLAT20",
    description: "20 AZN off",
    discount_type: "fixed" as const,
    discount_value: 20,
    min_order_amount: 100,
    max_uses: 50,
    used_count: 0,
    is_active: true,
    expires_at: null,
  },
];

// Hoisted spies — referenced inside the (hoisted) vi.mock factories.
const mocks = vi.hoisted(() => ({
  adminFetchSpy: vi.fn(),
  // The chainable anon-client read path that must NOT be used for the list.
  fromSpy: vi.fn(),
}));

// The admin API helper the fix is expected to call for the list read.
vi.mock("@/lib/admin-fetch", () => ({
  adminFetch: mocks.adminFetchSpy,
  adminJson: vi.fn(),
}));

// The browser Supabase client. `from` is the direct anon read path that must NOT
// be used by the list effect after the fix.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: mocks.fromSpy }),
  isSupabaseConfigured: () => true,
}));

// i18n: t() echoes the key so headings/labels are deterministic, queryable.
vi.mock("@/lib/i18n/context", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "en" }),
}));

/** Build a real Response so the page's `r.json()` works. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  // Post-fix path: GET /admin/coupons returns the raw coupon array.
  mocks.adminFetchSpy.mockResolvedValue(jsonResponse(COUPONS));

  // Pre-fix path: createClient().from("coupons").select("*").order(...) resolves
  // to an empty result so the UNFIXED page renders the empty state (no crash) —
  // making the behavioral assertions a meaningful RED, not a collection error.
  mocks.fromSpy.mockReturnValue({
    select: () => ({
      order: () => Promise.resolve({ data: [], error: null }),
    }),
  });
});

afterEach(() => {
  cleanup();
});

describe("SEC-003 CouponsPage reads the list via adminFetch (Property 3 / Property 8 [3.9])", () => {
  it("renders the page heading", () => {
    render(React.createElement(AdminCouponsPage));
    // t() echoes keys, so the title key renders verbatim.
    expect(screen.getByText("Admin.Coupons.title")).toBeTruthy();
  });

  it("loads the list via adminFetch('/admin/coupons') and renders the coupon codes", async () => {
    render(React.createElement(AdminCouponsPage));

    // Fix-Checking: the list is fetched through the admin API endpoint.
    await waitFor(() => {
      expect(mocks.adminFetchSpy).toHaveBeenCalledTimes(1);
    });
    const [calledUrl] = mocks.adminFetchSpy.mock.calls[0] as [string, ...unknown[]];
    expect(String(calledUrl)).toMatch(/\/admin\/coupons$/);

    // Preservation [3.9]: the rows still render, exactly as today.
    expect(await screen.findByText("WELCOME10")).toBeTruthy();
    expect(await screen.findByText("FLAT20")).toBeTruthy();
  });

  it("makes NO direct anon-client Supabase read of the coupons table", async () => {
    render(React.createElement(AdminCouponsPage));

    // Give any effect a chance to run.
    await waitFor(() => {
      expect(
        mocks.adminFetchSpy.mock.calls.length + mocks.fromSpy.mock.calls.length,
      ).toBeGreaterThan(0);
    });

    // Fix-Checking: the list read no longer goes through createClient().from("coupons").
    expect(mocks.fromSpy).not.toHaveBeenCalledWith("coupons");
  });
});
