import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * Integration test for end-to-end aggregate-only metrics ingest.
 *
 * Feature: super-admin-platform — Task 7.5
 * Requirements: 2.10, 9.2
 *
 * Exercises the `POST /platform/metrics/poll` handler against a mocked Store
 * registry and a mocked outbound `fetch` to each Store's metrics endpoint.
 *
 * NOTE ON HARNESS: this repo does not depend on `supertest`, and the existing
 * integration-style tests (e.g. `order-tracking-api.test.ts`) drive routes by
 * extracting the handler from the Express router's layer stack and invoking it
 * directly with mocked dependencies. This test follows that same established
 * pattern — the real router + real ingest whitelist run, only the control-plane
 * Supabase client and the outbound `fetch` are mocked.
 *
 * Assertions:
 *  1. The poller calls each Store endpoint with the correct Per_Store_Credential
 *     headers (X-Store-Id + Authorization: Bearer <hash>).
 *  2. Only whitelisted aggregates are persisted for the reachable store (no raw
 *     records), available=true with a fresh fetched_at.
 *  3. The unreachable store produces an available=false cache row (not dropped),
 *     and the Store_Registry is never mutated.
 */

// --- Mock the control-plane Supabase client (the ONLY DB the route may touch) ---
vi.mock("../src/lib/control-plane-supabase", () => ({
  getControlPlaneSupabase: vi.fn(),
}));

// --- Silence the singleton logger used inside the route ---
vi.mock("../src/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as controlPlane from "../src/lib/control-plane-supabase";
import metricsRouter from "../src/routes/platform/metrics";

const mockedGetControlPlaneSupabase = vi.mocked(controlPlane.getControlPlaneSupabase);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const STORE_A = {
  id: "store-aaa-111",
  metrics_endpoint_url: "https://store-a.example.com/metrics",
  per_store_credential_hash: "cred-hash-AAA",
};

const STORE_B = {
  id: "store-bbb-222",
  metrics_endpoint_url: "https://store-b.example.com/metrics",
  per_store_credential_hash: "cred-hash-BBB",
};

// Reachable store payload: valid aggregates PLUS raw-record-shaped noise that
// MUST be discarded by the ingest whitelist (R9.2).
function reachableStorePayload() {
  return {
    // whitelisted aggregates
    order_count: 12,
    revenue_total: "3456.78",
    traffic_count: 999,
    quota_usage: { products: 5, admin_users: 2, junk: "not-an-int" },
    // raw-record noise — MUST NOT be persisted
    orders: [{ id: "o1", customer: "Alice", total: 100 }],
    customers: [{ id: "c1", email: "alice@example.com" }],
    products: [{ id: "p1", title: "Widget" }],
    secret_internal_field: "should-never-persist",
  };
}

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

interface UpsertCall {
  table: string;
  values: Record<string, unknown>;
  options: unknown;
}

interface FakeRes {
  statusCode?: number;
  body?: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createRes(): FakeRes {
  const res = {} as FakeRes;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  });
  return res;
}

function createReq(): Request {
  return {
    headers: {},
    params: {},
    serviceActor: { type: "system" },
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  } as unknown as Request;
}

/**
 * Builds a control-plane client mock that:
 *  - serves the Store_Registry via from("stores").select(...)
 *  - captures every upsert against from("store_metrics_cache")
 *  - throws if any code attempts to MUTATE the "stores" registry (proves the
 *    registry is left untouched)
 */
function buildControlPlaneMock(registry: typeof STORE_A[]) {
  const upserts: UpsertCall[] = [];
  const storesMethodCalls: string[] = [];

  const cp = {
    from(table: string) {
      if (table === "stores") {
        // Only `select` is legitimate here. Any mutation method should blow up.
        return {
          select: (..._args: unknown[]) => {
            storesMethodCalls.push("select");
            return Promise.resolve({ data: registry, error: null });
          },
          upsert: () => {
            storesMethodCalls.push("upsert");
            throw new Error("registry mutated: stores.upsert called");
          },
          update: () => {
            storesMethodCalls.push("update");
            throw new Error("registry mutated: stores.update called");
          },
          delete: () => {
            storesMethodCalls.push("delete");
            throw new Error("registry mutated: stores.delete called");
          },
          insert: () => {
            storesMethodCalls.push("insert");
            throw new Error("registry mutated: stores.insert called");
          },
        };
      }
      if (table === "store_metrics_cache") {
        return {
          upsert: (values: Record<string, unknown>, options: unknown) => {
            upserts.push({ table, values, options });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table accessed: ${table}`);
    },
  };

  return { cp, upserts, storesMethodCalls };
}

// ---------------------------------------------------------------------------
// Extract the poll handler from the router (last handler after middleware)
// ---------------------------------------------------------------------------

function getPollHandler() {
  const stack = (metricsRouter as unknown as { stack: any[] }).stack;
  for (const layer of stack) {
    if (
      layer.route &&
      layer.route.path === "/platform/metrics/poll" &&
      layer.route.methods.post
    ) {
      const handlers = layer.route.stack;
      // [requireServiceCredential, handler] — the actual handler is last
      return handlers[handlers.length - 1].handle as (
        req: Request,
        res: Response,
      ) => Promise<void>;
    }
  }
  throw new Error("Could not find POST /platform/metrics/poll handler in router");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let capturedFetches: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  vi.clearAllMocks();
  capturedFetches = [];

  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    capturedFetches.push({ url, init });

    if (url.startsWith(STORE_A.metrics_endpoint_url)) {
      return {
        ok: true,
        status: 200,
        json: async () => reachableStorePayload(),
      } as unknown as Response;
    }

    // Store B is unreachable — fetch rejects (network error / connection refused)
    throw new Error("ECONNREFUSED");
  });

  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /platform/metrics/poll — end-to-end aggregate-only ingest (R2.10, R9.2)", () => {
  it("authenticates with each Store's Per_Store_Credential and persists only whitelisted aggregates", async () => {
    const { cp, upserts, storesMethodCalls } = buildControlPlaneMock([STORE_A, STORE_B]);
    mockedGetControlPlaneSupabase.mockReturnValue(cp as never);

    const req = createReq();
    const res = createRes();

    const before = Date.now();
    await getPollHandler()(req, res as unknown as Response);
    const after = Date.now();

    // ---- Summary response ----
    expect(res.body).toEqual({ polled: 2, succeeded: 1, failed: 1 });

    // ===================================================================
    // Assertion 1: correct Per_Store_Credential headers per store
    // ===================================================================
    expect(capturedFetches).toHaveLength(2);

    const fetchA = capturedFetches.find((f) =>
      f.url.startsWith(STORE_A.metrics_endpoint_url),
    );
    const fetchB = capturedFetches.find((f) =>
      f.url.startsWith(STORE_B.metrics_endpoint_url),
    );
    expect(fetchA).toBeDefined();
    expect(fetchB).toBeDefined();

    const headersA = fetchA!.init.headers as Record<string, string>;
    expect(headersA["X-Store-Id"]).toBe(STORE_A.id);
    expect(headersA["Authorization"]).toBe(`Bearer ${STORE_A.per_store_credential_hash}`);

    const headersB = fetchB!.init.headers as Record<string, string>;
    expect(headersB["X-Store-Id"]).toBe(STORE_B.id);
    expect(headersB["Authorization"]).toBe(`Bearer ${STORE_B.per_store_credential_hash}`);

    // Each store authenticated with its OWN distinct credential (no cross-use)
    expect(headersA["Authorization"]).not.toBe(headersB["Authorization"]);

    // Request carries the from/to date-range query params
    expect(fetchA!.url).toMatch(/[?&]from=\d{4}-\d{2}-\d{2}/);
    expect(fetchA!.url).toMatch(/[?&]to=\d{4}-\d{2}-\d{2}/);

    // ===================================================================
    // Assertion 2: reachable store persists ONLY whitelisted aggregates,
    //              available=true, fresh fetched_at
    // ===================================================================
    // All persistence goes to store_metrics_cache only (registry untouched)
    expect(upserts.every((u) => u.table === "store_metrics_cache")).toBe(true);

    const cacheA = upserts.find((u) => u.values.store_id === STORE_A.id);
    expect(cacheA).toBeDefined();

    // Exact whitelisted key set — no raw-record fields leaked through
    expect(Object.keys(cacheA!.values).sort()).toEqual(
      [
        "available",
        "fetched_at",
        "order_count",
        "quota_usage",
        "revenue_total",
        "store_id",
        "traffic_count",
      ].sort(),
    );

    // Aggregate values correctly typed/parsed
    expect(cacheA!.values.order_count).toBe(12);
    expect(cacheA!.values.revenue_total).toBe(3456.78); // parsed to number
    expect(cacheA!.values.traffic_count).toBe(999);
    // quota_usage keeps only non-negative integers (junk string dropped)
    expect(cacheA!.values.quota_usage).toEqual({ products: 5, admin_users: 2 });
    expect(cacheA!.values.available).toBe(true);
    expect(cacheA!.options).toEqual({ onConflict: "store_id" });

    // No raw-record-shaped fields persisted
    for (const forbidden of ["orders", "customers", "products", "secret_internal_field"]) {
      expect(cacheA!.values).not.toHaveProperty(forbidden);
    }

    // fetched_at is fresh (within the handler invocation window)
    const fetchedAtA = Date.parse(cacheA!.values.fetched_at as string);
    expect(Number.isNaN(fetchedAtA)).toBe(false);
    expect(fetchedAtA).toBeGreaterThanOrEqual(before - 1000);
    expect(fetchedAtA).toBeLessThanOrEqual(after + 1000);

    // ===================================================================
    // Assertion 3: unreachable store → available=false row (not dropped),
    //              registry untouched
    // ===================================================================
    const cacheB = upserts.find((u) => u.values.store_id === STORE_B.id);
    expect(cacheB).toBeDefined(); // row persisted, NOT dropped
    expect(cacheB!.values.available).toBe(false);
    expect(cacheB!.options).toEqual({ onConflict: "store_id" });

    // unreachable upsert does NOT clear cached numbers (only flips availability)
    expect(cacheB!.values).not.toHaveProperty("order_count");
    expect(cacheB!.values).not.toHaveProperty("revenue_total");

    const fetchedAtB = Date.parse(cacheB!.values.fetched_at as string);
    expect(Number.isNaN(fetchedAtB)).toBe(false);

    // Registry was read (select) but never mutated
    expect(storesMethodCalls).toEqual(["select"]);
  });

  it("keeps the unreachable Store in the registry even when ALL stores are unreachable", async () => {
    // Re-stub fetch so BOTH stores fail
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedFetches.push({ url, init });
        throw new Error("ETIMEDOUT");
      }),
    );

    const { cp, upserts, storesMethodCalls } = buildControlPlaneMock([STORE_A, STORE_B]);
    mockedGetControlPlaneSupabase.mockReturnValue(cp as never);

    const req = createReq();
    const res = createRes();
    await getPollHandler()(req, res as unknown as Response);

    expect(res.body).toEqual({ polled: 2, succeeded: 0, failed: 2 });

    // Both stores got an available=false cache row (none dropped)
    expect(upserts).toHaveLength(2);
    expect(upserts.every((u) => u.table === "store_metrics_cache")).toBe(true);
    expect(upserts.every((u) => u.values.available === false)).toBe(true);
    expect(upserts.map((u) => u.values.store_id).sort()).toEqual(
      [STORE_A.id, STORE_B.id].sort(),
    );

    // Registry untouched
    expect(storesMethodCalls).toEqual(["select"]);
  });

  it("non-200 store responses mark available=false without dropping the row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedFetches.push({ url, init });
        // Store A returns 500, Store B returns 200 with aggregates
        if (url.startsWith(STORE_A.metrics_endpoint_url)) {
          return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ order_count: 3, revenue_total: "10.00" }),
        } as unknown as Response;
      }),
    );

    const { cp, upserts } = buildControlPlaneMock([STORE_A, STORE_B]);
    mockedGetControlPlaneSupabase.mockReturnValue(cp as never);

    const req = createReq();
    const res = createRes();
    await getPollHandler()(req, res as unknown as Response);

    expect(res.body).toEqual({ polled: 2, succeeded: 1, failed: 1 });

    const cacheA = upserts.find((u) => u.values.store_id === STORE_A.id);
    expect(cacheA).toBeDefined();
    expect(cacheA!.values.available).toBe(false);

    const cacheB = upserts.find((u) => u.values.store_id === STORE_B.id);
    expect(cacheB).toBeDefined();
    expect(cacheB!.values.available).toBe(true);
    expect(cacheB!.values.order_count).toBe(3);
    expect(cacheB!.values.revenue_total).toBe(10);
  });
});
