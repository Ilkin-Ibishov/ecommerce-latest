import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * Integration test for the store-side Store_Metrics_Endpoint
 * (GET /api/store-metrics).
 *
 * Feature: super-admin-platform (Task 6.4)
 * Validates: Requirements 9.3, 9.4, 9.5
 *
 * This is an INTEGRATION test: it mounts the real `store-metrics` router on a
 * real Express app, exercises the REAL Per_Store_Credential guard
 * (`verifyStoreCredential` is NOT mocked), and drives it over real HTTP
 * requests against a temporary server (no supertest — supertest is not a
 * project dependency, so this follows the house integration pattern used by
 * `brands-public.test.ts`: `app.listen(0)` + global `fetch`).
 *
 * Only the Store's own data layer (`getAdminSupabase`) is mocked, so the test
 * is hermetic and never touches a live Supabase. The assertions cover:
 *
 *   1. Foreign / missing / wrong Per_Store_Credential is rejected (403/401)
 *      and the response carries NO store data.
 *   2. A correctly-credentialed request returns a success payload containing
 *      ONLY the whitelisted aggregate fields (order_count, revenue_total,
 *      traffic_count, quota_usage, range) — and NO raw orders/customers/
 *      products arrays.
 */

// ---------------------------------------------------------------------------
// Mock ONLY the Store's data layer — the credential guard stays real.
// ---------------------------------------------------------------------------

// Per-table mock results, mutable so each test can shape them.
let mockOrdersResult: { count?: number | null; data?: any; error: any } = {
  count: 0,
  data: [],
  error: null,
};
let mockProductsResult: { count?: number | null; error: any } = {
  count: 0,
  error: null,
};
let mockUsersResult: { count?: number | null; error: any } = {
  count: 0,
  error: null,
};

/**
 * A chainable + thenable query-builder stub. Every Supabase query method
 * (`select`/`gte`/`lte`/`eq`/`order`/`single`) returns the same builder, and
 * the builder itself is awaitable, resolving to the per-table result. This
 * faithfully models the handler's chains:
 *   orders   : select().gte().lte()
 *   products : select()
 *   users    : select().eq()
 */
function makeBuilder(result: unknown) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    single: () => builder,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

vi.mock("../src/lib/supabase", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "orders") return makeBuilder(mockOrdersResult);
      if (table === "products") return makeBuilder(mockProductsResult);
      if (table === "users") return makeBuilder(mockUsersResult);
      return makeBuilder({ data: [], count: 0, error: null });
    },
  }),
}));

// Import the route AFTER the mock is registered.
import storeMetricsRouter from "../src/routes/store-metrics";
import express from "express";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const THIS_STORE_ID = "11111111-1111-1111-1111-111111111111";
const THIS_STORE_SECRET = "this-store-super-secret-value";
const FOREIGN_STORE_ID = "22222222-2222-2222-2222-222222222222";

const WHITELISTED_KEYS = [
  "order_count",
  "quota_usage",
  "range",
  "revenue_total",
  "traffic_count",
].sort();

// Fields that would indicate a raw-record leak — must never appear.
const FORBIDDEN_RAW_KEYS = [
  "orders",
  "customers",
  "products",
  "users",
  "items",
  "rows",
  "records",
];

const prevStoreId = process.env.STORE_ID;
const prevStoreSecret = process.env.STORE_PLATFORM_SECRET;

function createApp() {
  const app = express();
  app.use(express.json());
  // Minimal req.log used by the route handler's error paths.
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  // Mount under /api to mirror production wiring (/api/store-metrics).
  app.use("/api", storeMetricsRouter);
  return app;
}

/** Make a real HTTP GET against the mounted app on a random port. */
async function makeRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  headers?: Record<string, string>,
) {
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: headers ?? {},
    });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const RANGE_QS = "?from=2024-01-01&to=2024-01-31";

beforeEach(() => {
  process.env.STORE_ID = THIS_STORE_ID;
  process.env.STORE_PLATFORM_SECRET = THIS_STORE_SECRET;

  // Default success-shaped data: 3 orders summing to 35.50, 7 products, 2 admins.
  mockOrdersResult = {
    count: 3,
    data: [{ total_azn: "10.00" }, { total_azn: "20.50" }, { total_azn: "5" }],
    error: null,
  };
  mockProductsResult = { count: 7, error: null };
  mockUsersResult = { count: 2, error: null };
});

afterAll(() => {
  // Restore env so we don't leak fixtures into other (shuffled) test files.
  if (prevStoreId === undefined) delete process.env.STORE_ID;
  else process.env.STORE_ID = prevStoreId;
  if (prevStoreSecret === undefined) delete process.env.STORE_PLATFORM_SECRET;
  else process.env.STORE_PLATFORM_SECRET = prevStoreSecret;
});

// ---------------------------------------------------------------------------
// 1. Credential rejection — no store data on any failure (R9.3, R9.6)
// ---------------------------------------------------------------------------

describe("GET /api/store-metrics — credential rejection (R9.3)", () => {
  function assertNoStoreData(body: Record<string, unknown>) {
    // None of the aggregate fields leak on a rejection.
    for (const key of WHITELISTED_KEYS) {
      expect(body).not.toHaveProperty(key);
    }
    // And certainly no raw-record arrays.
    for (const key of FORBIDDEN_RAW_KEYS) {
      expect(body).not.toHaveProperty(key);
    }
  }

  it("rejects a FOREIGN credential (X-Store-Id of another store) with 403 and no data", async () => {
    const app = createApp();
    const res = await makeRequest(app, `/api/store-metrics${RANGE_QS}`, {
      "X-Store-Id": FOREIGN_STORE_ID,
      Authorization: `Bearer ${THIS_STORE_SECRET}`,
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
    assertNoStoreData(res.body);
  });

  it("rejects a MISSING credential (no X-Store-Id, no bearer) with 401 and no data", async () => {
    const app = createApp();
    const res = await makeRequest(app, `/api/store-metrics${RANGE_QS}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "authentication required" });
    assertNoStoreData(res.body);
  });

  it("rejects a present store id but MISSING bearer with 401 and no data", async () => {
    const app = createApp();
    const res = await makeRequest(app, `/api/store-metrics${RANGE_QS}`, {
      "X-Store-Id": THIS_STORE_ID,
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "authentication required" });
    assertNoStoreData(res.body);
  });

  it("rejects a WRONG secret (correct store id, bad bearer) with 403 and no data", async () => {
    const app = createApp();
    const res = await makeRequest(app, `/api/store-metrics${RANGE_QS}`, {
      "X-Store-Id": THIS_STORE_ID,
      Authorization: "Bearer totally-wrong-secret",
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
    assertNoStoreData(res.body);
  });
});

// ---------------------------------------------------------------------------
// 2. Aggregate-only success payload (R9.4, R9.5)
// ---------------------------------------------------------------------------

describe("GET /api/store-metrics — aggregate-only success payload (R9.4, R9.5)", () => {
  it("returns 200 with ONLY whitelisted aggregate fields for a valid credential", async () => {
    const app = createApp();
    const res = await makeRequest(app, `/api/store-metrics${RANGE_QS}`, {
      "X-Store-Id": THIS_STORE_ID,
      Authorization: `Bearer ${THIS_STORE_SECRET}`,
    });

    expect(res.status).toBe(200);

    // Exactly the whitelisted aggregate keys — nothing more, nothing less.
    expect(Object.keys(res.body).sort()).toEqual(WHITELISTED_KEYS);

    // Aggregate values are computed correctly from the (mocked) store DB.
    expect(res.body.order_count).toBe(3);
    expect(res.body.revenue_total).toBe("35.50"); // 10.00 + 20.50 + 5 → 2dp string
    expect(res.body.traffic_count).toBeNull();
    expect(res.body.quota_usage).toEqual({ products: 7, admin_users: 2 });
    expect(res.body.range).toEqual({ from: "2024-01-01", to: "2024-01-31" });
  });

  it("returns NO raw orders/customers/products records (only aggregates)", async () => {
    const app = createApp();
    const res = await makeRequest(app, `/api/store-metrics${RANGE_QS}`, {
      "X-Store-Id": THIS_STORE_ID,
      Authorization: `Bearer ${THIS_STORE_SECRET}`,
    });

    expect(res.status).toBe(200);

    // No raw-record collections anywhere at the top level.
    for (const key of FORBIDDEN_RAW_KEYS) {
      expect(res.body).not.toHaveProperty(key);
    }

    // No top-level field is an array of records — every value is a scalar or
    // a small aggregate object (range / quota_usage).
    for (const [key, value] of Object.entries(res.body)) {
      expect(Array.isArray(value), `${key} must not be a raw-record array`).toBe(
        false,
      );
    }

    // revenue_total is a 2-decimal monetary string (R9.4), not a raw total list.
    expect(res.body.revenue_total).toMatch(/^\d+\.\d{2}$/);

    // order_count is a non-negative integer, not a list of orders (R9.5).
    expect(Number.isInteger(res.body.order_count)).toBe(true);
    expect(res.body.order_count).toBeGreaterThanOrEqual(0);

    // quota_usage holds only numeric counts, never nested record arrays.
    for (const v of Object.values(res.body.quota_usage)) {
      expect(typeof v).toBe("number");
    }
  });

  it("reports zero aggregates (still aggregate-only) when the store has no data", async () => {
    mockOrdersResult = { count: 0, data: [], error: null };
    mockProductsResult = { count: 0, error: null };
    mockUsersResult = { count: 0, error: null };

    const app = createApp();
    const res = await makeRequest(app, `/api/store-metrics${RANGE_QS}`, {
      "X-Store-Id": THIS_STORE_ID,
      Authorization: `Bearer ${THIS_STORE_SECRET}`,
    });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(WHITELISTED_KEYS);
    expect(res.body.order_count).toBe(0);
    expect(res.body.revenue_total).toBe("0.00");
    expect(res.body.quota_usage).toEqual({ products: 0, admin_users: 0 });
  });
});
