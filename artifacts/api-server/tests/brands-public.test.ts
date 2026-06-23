import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the public brands endpoint (GET /api/brands).
 *
 * Validates: Requirements 5.1, 5.4
 *
 * These tests mock getAdminSupabase and the platformStatus middleware to
 * isolate the route handler logic and verify:
 * - Active brand entries are returned ordered by sort_order ASC
 * - Empty array is returned when no active brands exist
 * - brand_banner_enabled setting value is included in the response
 * - Endpoint is accessible without authentication
 */

// Mock platformStatus middleware to always pass through
vi.mock("../src/middlewares/platformStatus", () => ({
  platformStatus: () => (_req: any, _res: any, next: any) => next(),
}));

// Store mock results so tests can control Supabase responses
let mockBrandsResult: { data: any; error: any } = { data: [], error: null };
let mockSettingResult: { data: any; error: any } = { data: null, error: null };

vi.mock("../src/lib/supabase", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "brand_entries") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve(mockBrandsResult),
            }),
          }),
        };
      }
      if (table === "store_settings") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(mockSettingResult),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

// Import the route AFTER mocks are set up
import brandsPublicRouter from "../src/routes/brands-public";
import express from "express";

function createApp() {
  const app = express();
  app.use(express.json());
  // Add a minimal req.log for the route handler
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(brandsPublicRouter);
  return app;
}

/** Helper to make HTTP requests against the Express app using undici */
async function makeRequest(app: ReturnType<typeof createApp>, path: string, headers?: Record<string, string>) {
  // Start a temporary server on a random port
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const url = `http://127.0.0.1:${port}${path}`;
    const res = await fetch(url, {
      headers: headers ?? {},
    });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

describe("GET /brands (public endpoint)", () => {
  beforeEach(() => {
    mockBrandsResult = { data: [], error: null };
    mockSettingResult = { data: null, error: null };
  });

  it("returns active entries ordered by sort_order ASC", async () => {
    const brands = [
      { id: "b1", name: "Brand A", logo_url: "https://example.com/a.png", sort_order: 1 },
      { id: "b2", name: "Brand B", logo_url: "https://example.com/b.png", sort_order: 2 },
      { id: "b3", name: "Brand C", logo_url: "https://example.com/c.png", sort_order: 3 },
    ];
    mockBrandsResult = { data: brands, error: null };
    mockSettingResult = { data: { value: "true" }, error: null };

    const app = createApp();
    const res = await makeRequest(app, "/brands");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(brands);
    expect(res.body.data[0].sort_order).toBe(1);
    expect(res.body.data[1].sort_order).toBe(2);
    expect(res.body.data[2].sort_order).toBe(3);
  });

  it("returns empty array when no active brands exist", async () => {
    mockBrandsResult = { data: [], error: null };
    mockSettingResult = { data: { value: "true" }, error: null };

    const app = createApp();
    const res = await makeRequest(app, "/brands");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], brand_banner_enabled: "true" });
  });

  it("includes brand_banner_enabled value from store_settings", async () => {
    mockBrandsResult = { data: [], error: null };
    mockSettingResult = { data: { value: "false" }, error: null };

    const app = createApp();
    const res = await makeRequest(app, "/brands");

    expect(res.status).toBe(200);
    expect(res.body.brand_banner_enabled).toBe("false");
  });

  it("defaults brand_banner_enabled to 'true' when setting does not exist", async () => {
    mockBrandsResult = { data: [], error: null };
    // When the setting row doesn't exist, .single() returns { data: null, error: ... }
    mockSettingResult = { data: null, error: { code: "PGRST116", message: "not found" } };

    const app = createApp();
    const res = await makeRequest(app, "/brands");

    expect(res.status).toBe(200);
    expect(res.body.brand_banner_enabled).toBe("true");
  });

  it("does not require auth headers (accessible without token)", async () => {
    mockBrandsResult = {
      data: [{ id: "b1", name: "Test Brand", logo_url: null, sort_order: 0 }],
      error: null,
    };
    mockSettingResult = { data: { value: "true" }, error: null };

    const app = createApp();
    // No Authorization header
    const res = await makeRequest(app, "/brands");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("returns 500 when brands query fails", async () => {
    mockBrandsResult = { data: null, error: { message: "DB error" } };
    mockSettingResult = { data: { value: "true" }, error: null };

    const app = createApp();
    const res = await makeRequest(app, "/brands");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch brands");
  });
});
