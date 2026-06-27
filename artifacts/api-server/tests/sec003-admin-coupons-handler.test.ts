import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * SEC-003 — `GET /admin/coupons` request shaping: admin gets the list, non-admin
 * is rejected 403 (vitest, no DB).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    15 (P1 unit/property tests) — TEST-FIRST: written BEFORE task 12.1 lands.
 * Design:  Property 3 (Fix-Checking) — after the public coupon-read RLS policy is
 *          dropped, the admin coupon list is served ONLY via a service-role
 *          endpoint guarded by `requireAdmin`. The new route is
 *          `GET /admin/coupons` in routes/admin/coupons.ts returning
 *          `res.json(data ?? [])` (an array), ordered by created_at desc.
 * Requirements: 2.3, 2.9.
 *
 * ── Approach (mirrors tests/sec008-profile-handler.test.ts) ─────────────────
 * Mount the REAL routes/admin/coupons.ts router on a throwaway Express app over
 * an ephemeral port (the codebase ships no supertest). Two dependencies are
 * stubbed so the test is pure (no DB, no auth backend):
 *   • `requireAdmin` middleware → toggled per test via a hoisted flag:
 *       admin  → sets `req.admin` to a chainable recorder + next()
 *       client → responds 403 { error: "Forbidden" } (the real middleware shape)
 *     Mocking the middleware module also means the real `../src/lib/supabase`
 *     (and its env/service-role-key requirements) is never loaded.
 *   • The `req.admin` recorder resolves `from("coupons").select("*").order(...)`
 *     to `{ data: ROWS, error: null }`, matching the design's await chain.
 *
 * ── Test-first expectation (lazy route resolution) ──────────────────────────
 * The `GET /admin/coupons` route does NOT exist yet (created by task 12.1); the
 * router currently registers only POST/PATCH/DELETE. So hitting GET today yields
 * a 404 from Express (the route is unmatched and the mocked middleware never
 * runs). Both tests below detect that 404 and FAIL MEANINGFULLY
 * ("route not registered yet — pending task 12.1") rather than crashing
 * collection. After task 12.1 adds the literal GET route, the SAME tests turn
 * green with no edit.
 *
 * ── Coupon-calc / validate PRESERVATION (Property 8 [3.3]) ──────────────────
 * Task 15 also calls for preservation coverage of `POST /api/coupons/validate`
 * and `calculateDiscount()` across generated subtotals / coupon configs. That
 * behavior is ALREADY fully covered by existing suites and is intentionally NOT
 * duplicated here (per task instruction + agent-behaviors "test quality over
 * quantity"):
 *   • tests/coupon-calc.property.test.ts — fast-check properties over
 *     calculateDiscount (percentage/fixed/min-order/rounding/cap across
 *     generated subtotals + discount values).
 *   • tests/coupons.test.ts — POST /api/coupons/validate integration (valid /
 *     invalid / expired codes, correct discount amount).
 * SEC-003 changes only the anon RLS read path + the admin list source; the
 * server-side validation + math are untouched, so those existing green tests ARE
 * the preservation assertion for [3.3]. Nothing is missing to add here.
 */

// Hoisted shared state + fixture rows — defined INSIDE the factory because
// vi.hoisted runs before module-level const initialization (a top-level
// `const ADMIN_ROWS` would be in the temporal dead zone here).
const h = vi.hoisted(() => {
  const rows = [
    {
      id: "coupon-1",
      code: "WELCOME10",
      description: "Welcome 10%",
      discount_type: "percentage",
      discount_value: 10,
      min_order_amount: null,
      max_uses: null,
      used_count: 3,
      is_active: true,
      expires_at: null,
      created_at: "2024-02-01T00:00:00.000Z",
    },
    {
      id: "coupon-2",
      code: "FLAT20",
      description: "20 AZN off",
      discount_type: "fixed",
      discount_value: 20,
      min_order_amount: 100,
      max_uses: 50,
      used_count: 0,
      is_active: true,
      expires_at: null,
      created_at: "2024-01-15T00:00:00.000Z",
    },
  ];

  const state: {
    isAdmin: boolean;
    fromArg: string | null;
    selectArg: string | null;
    orderCol: string | null;
    orderOpts: unknown;
  } = {
    isAdmin: true,
    fromArg: null,
    selectArg: null,
    orderCol: null,
    orderOpts: undefined,
  };

  function reset() {
    state.isAdmin = true;
    state.fromArg = null;
    state.selectArg = null;
    state.orderCol = null;
    state.orderOpts = undefined;
  }

  return { state, reset, rows };
});

// Mock the requireAdmin middleware. When admin: inject a chainable `req.admin`
// recorder and proceed. When not: reproduce the real 403 { error: "Forbidden" }.
vi.mock("../src/middlewares/requireAdmin", () => ({
  requireAdmin: (
    req: { admin?: unknown; user?: unknown },
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ): void => {
    if (!h.state.isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    req.user = { id: "admin-user" };
    req.admin = {
      from(table: string) {
        h.state.fromArg = table;
        return {
          select(cols: string) {
            h.state.selectArg = cols;
            return {
              order(col: string, opts: unknown) {
                h.state.orderCol = col;
                h.state.orderOpts = opts;
                return Promise.resolve({ data: h.rows, error: null });
              },
            };
          },
        };
      },
    };
    next();
  },
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Imported AFTER the mock is registered so the router picks up the stub.
  const express = (await import("express")).default;
  const couponsRouter = (await import("../src/routes/admin/coupons")).default;

  const app = express();
  app.use(express.json());
  app.use(couponsRouter); // router paths are "/admin/coupons"

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.reset();
});

/** Fail meaningfully if the literal GET route is not registered yet (task 12.1). */
function assertRouteRegistered(status: number): void {
  if (status === 404) {
    throw new Error(
      "GET /admin/coupons is not registered yet — pending task 12.1 " +
        "(routes/admin/coupons.ts currently exposes only POST/PATCH/DELETE). " +
        "This is the expected RED state for the test-first contract.",
    );
  }
}

describe("SEC-003 GET /admin/coupons request shaping (Property 3)", () => {
  it("admin → 200 with the coupon rows, read via req.admin (service role) ordered created_at desc", async () => {
    h.state.isAdmin = true;

    const res = await fetch(`${baseUrl}/admin/coupons`, { method: "GET" });
    assertRouteRegistered(res.status);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Design returns the raw array (`res.json(data ?? [])`).
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(h.rows.length);
    expect(body.map((c: { code: string }) => c.code)).toEqual(["WELCOME10", "FLAT20"]);

    // The list is read from the service-role client, from the coupons table,
    // ordered by created_at descending.
    expect(h.state.fromArg).toBe("coupons");
    expect(h.state.orderCol).toBe("created_at");
    expect(h.state.orderOpts).toEqual({ ascending: false });
  });

  it("non-admin → 403 Forbidden and no coupon read occurs", async () => {
    h.state.isAdmin = false;

    const res = await fetch(`${baseUrl}/admin/coupons`, { method: "GET" });
    assertRouteRegistered(res.status);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Forbidden" });

    // requireAdmin short-circuits before the handler — no table read happened.
    expect(h.state.fromArg).toBeNull();
  });
});
