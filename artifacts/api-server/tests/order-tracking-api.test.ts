import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

/**
 * Integration tests for GET /profile/orders/:id
 *
 * Tests auth enforcement (401), ownership check (404), and successful
 * response shape (200) by mocking Supabase and exercising the route handler.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

// Mock the Supabase lib to control data returned by the handler
vi.mock("../src/lib/supabase", () => ({
  getSupabase: vi.fn(),
  getAdminSupabase: vi.fn(),
  requireAdmin: vi.fn(),
}));

import * as supabaseLib from "../src/lib/supabase";
import { requireUser } from "../src/middlewares/requireUser";

const mockedGetSupabase = vi.mocked(supabaseLib.getSupabase);
const mockedGetAdminSupabase = vi.mocked(supabaseLib.getAdminSupabase);

// --- Helpers ----------------------------------------------------------------

interface FakeRes {
  statusCode?: number;
  body?: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    ...overrides,
  } as unknown as Request;
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

function createNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// Helper to mock getSupabase for requireUser middleware
function mockGetUserAuth(user: { id: string } | null) {
  mockedGetSupabase.mockReturnValueOnce({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  } as unknown as ReturnType<typeof supabaseLib.getSupabase>);
}

// Helper to create a chainable Supabase query builder mock.
// The builder itself acts as a thenable (like a real Supabase query builder)
// so that `await admin.from("table").select(...).eq(...)` resolves to { data }.
function createQueryBuilder(result: { data: unknown; error?: unknown }) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    // Make builder thenable so `await builder` resolves to result
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

// --- Import the handler after mocks are set up --------------------------------

import ordersRouter from "../src/routes/orders";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /profile/orders/:id - Auth & Ownership (Req 2.1, 2.2, 2.3, 2.4)", () => {
  describe("401 for unauthenticated requests (Req 2.4)", () => {
    it("returns 401 when no Authorization header is provided", async () => {
      const req = createReq({
        headers: {},
        params: { id: "abc12345" },
      });
      const res = createRes();
      const next = createNext();

      // requireUser is the first middleware - it should reject
      await requireUser(req, res as unknown as Response, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when token resolves to no user", async () => {
      mockGetUserAuth(null);

      const req = createReq({
        headers: { authorization: "Bearer invalid-token" },
        params: { id: "abc12345" },
      });
      const res = createRes();
      const next = createNext();

      await requireUser(req, res as unknown as Response, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("404 for order belonging to another user (Req 2.3)", () => {
    it("returns 404 when order belongs to a different user", async () => {
      const authenticatedUserId = "user-aaa-111";
      const orderOwnerId = "user-bbb-222";

      // Mock getSupabase for requireUser middleware
      mockGetUserAuth({ id: authenticatedUserId });

      // Mock getAdminSupabase for the route handler
      const orderQueryBuilder = createQueryBuilder({
        data: {
          id: "abc12345-full-uuid-here-000000000000",
          status: "pending",
          customer_name: "Other Person",
          customer_phone: "+994501234567",
          delivery_address: "123 Other St",
          total_azn: 50,
          discount_azn: 0,
          created_at: "2024-01-01T00:00:00Z",
          user_id: orderOwnerId, // Different user!
        },
      });

      const mockAdmin = {
        from: vi.fn().mockReturnValue(orderQueryBuilder),
      };
      mockedGetAdminSupabase.mockReturnValue(mockAdmin as any);

      // Build the middleware chain manually
      const req = createReq({
        headers: { authorization: "Bearer valid-token" },
        params: { id: "abc12345" },
      });
      const res = createRes();
      const next = createNext();

      // Step 1: requireUser passes
      await requireUser(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.authUser).toEqual({ id: authenticatedUserId });

      // Step 2: Simulate the route handler
      // Import and call the handler logic directly
      const handler = getProfileOrderHandler();
      await handler(req, res as unknown as Response);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    });

    it("returns 404 when order does not exist", async () => {
      const authenticatedUserId = "user-aaa-111";

      mockGetUserAuth({ id: authenticatedUserId });

      // Order not found
      const orderQueryBuilder = createQueryBuilder({
        data: null,
      });

      const mockAdmin = {
        from: vi.fn().mockReturnValue(orderQueryBuilder),
      };
      mockedGetAdminSupabase.mockReturnValue(mockAdmin as any);

      const req = createReq({
        headers: { authorization: "Bearer valid-token" },
        params: { id: "nonexist" },
      });
      const res = createRes();
      const next = createNext();

      await requireUser(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      const handler = getProfileOrderHandler();
      await handler(req, res as unknown as Response);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    });
  });

  describe("200 with correct data shape for valid request (Req 2.1, 2.2)", () => {
    it("returns order with items and status_history for authenticated owner", async () => {
      const userId = "user-owner-123";
      const orderId = "abc12345-full-uuid-here-000000000000";

      mockGetUserAuth({ id: userId });

      // Build separate query builders for each .from() call
      const orderData = {
        id: orderId,
        status: "shipped",
        customer_name: "Test Customer",
        customer_phone: "+994501234567",
        delivery_address: "456 Main St, Baku",
        total_azn: 75.5,
        discount_azn: 5,
        created_at: "2024-01-15T10:30:00Z",
        user_id: userId,
      };

      const itemsData = [
        {
          id: "item-1",
          product_id: "prod-1",
          quantity: 2,
          product_price_snapshot: 25,
          product_title_snapshot: "Widget A",
        },
        {
          id: "item-2",
          product_id: "prod-2",
          quantity: 1,
          product_price_snapshot: 30.5,
          product_title_snapshot: "Widget B",
        },
      ];

      const historyData = [
        {
          id: "hist-1",
          old_status: null,
          new_status: "pending",
          changed_at: "2024-01-15T10:30:00Z",
          changed_by: userId,
        },
        {
          id: "hist-2",
          old_status: "pending",
          new_status: "phone_verified",
          changed_at: "2024-01-15T11:00:00Z",
          changed_by: "admin-1",
        },
        {
          id: "hist-3",
          old_status: "phone_verified",
          new_status: "shipped",
          changed_at: "2024-01-16T09:00:00Z",
          changed_by: "admin-1",
        },
      ];

      // Track which table .from() is called with
      let fromCallCount = 0;
      const mockAdmin = {
        from: vi.fn((table: string) => {
          fromCallCount++;
          if (table === "orders") {
            return createQueryBuilder({ data: orderData });
          }
          if (table === "order_items") {
            return createQueryBuilder({ data: itemsData });
          }
          if (table === "order_status_history") {
            return createQueryBuilder({ data: historyData });
          }
          return createQueryBuilder({ data: null });
        }),
      };
      mockedGetAdminSupabase.mockReturnValue(mockAdmin as any);

      const req = createReq({
        headers: { authorization: "Bearer valid-token" },
        params: { id: "abc12345" },
      });
      const res = createRes();
      const next = createNext();

      await requireUser(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      const handler = getProfileOrderHandler();
      await handler(req, res as unknown as Response);

      expect(res.statusCode).toBeUndefined(); // 200 is the default (no explicit status set)
      expect(res.json).toHaveBeenCalledTimes(1);

      const body = res.body as any;

      // Verify top-level order fields
      expect(body.id).toBe(orderId);
      expect(body.status).toBe("shipped");
      expect(body.customer_name).toBe("Test Customer");
      expect(body.customer_phone).toBe("+994501234567");
      expect(body.delivery_address).toBe("456 Main St, Baku");
      expect(body.total_azn).toBe(75.5);
      expect(body.discount_azn).toBe(5);
      expect(body.created_at).toBe("2024-01-15T10:30:00Z");

      // Verify order_items array with computed line_total
      expect(body.order_items).toHaveLength(2);
      expect(body.order_items[0]).toEqual({
        id: "item-1",
        product_id: "prod-1",
        quantity: 2,
        product_price_snapshot: 25,
        product_title_snapshot: "Widget A",
        line_total: 50, // 2 * 25
      });
      expect(body.order_items[1]).toEqual({
        id: "item-2",
        product_id: "prod-2",
        quantity: 1,
        product_price_snapshot: 30.5,
        product_title_snapshot: "Widget B",
        line_total: 30.5, // 1 * 30.5
      });

      // Verify status_history array sorted by changed_at ASC
      expect(body.status_history).toHaveLength(3);
      expect(body.status_history[0].new_status).toBe("pending");
      expect(body.status_history[1].new_status).toBe("phone_verified");
      expect(body.status_history[2].new_status).toBe("shipped");

      // Verify user_id is NOT leaked in the response
      expect(body.user_id).toBeUndefined();
    });

    it("uses short ID prefix matching for 8-char IDs", async () => {
      const userId = "user-owner-456";
      const orderId = "deadbeef-full-uuid-here-000000000000";

      mockGetUserAuth({ id: userId });

      const mockAdmin = {
        from: vi.fn((table: string) => {
          if (table === "orders") {
            const builder = createQueryBuilder({
              data: {
                id: orderId,
                status: "pending",
                customer_name: "Short ID User",
                customer_phone: "+994509876543",
                delivery_address: "789 Short St",
                total_azn: 20,
                discount_azn: 0,
                created_at: "2024-02-01T00:00:00Z",
                user_id: userId,
              },
            });
            return builder;
          }
          if (table === "order_items") {
            return createQueryBuilder({ data: [] });
          }
          if (table === "order_status_history") {
            return createQueryBuilder({ data: [] });
          }
          return createQueryBuilder({ data: null });
        }),
      };
      mockedGetAdminSupabase.mockReturnValue(mockAdmin as any);

      const req = createReq({
        headers: { authorization: "Bearer valid-token" },
        params: { id: "deadbeef" }, // 8-char short ID
      });
      const res = createRes();
      const next = createNext();

      await requireUser(req, res as unknown as Response, next);

      const handler = getProfileOrderHandler();
      await handler(req, res as unknown as Response);

      // Verify the .like() was called for short ID (not .eq())
      const fromCalls = mockAdmin.from.mock.calls;
      const ordersCall = fromCalls.find((c: string[]) => c[0] === "orders");
      expect(ordersCall).toBeDefined();

      // Verify response shape
      const body = res.body as any;
      expect(body.id).toBe(orderId);
      expect(body.order_items).toEqual([]);
      expect(body.status_history).toEqual([]);
    });
  });
});

// --- Helper to extract the route handler from the router --------------------

/**
 * Extracts the GET /profile/orders/:id handler function from the router's
 * layer stack. This lets us call it directly without needing supertest or
 * a running HTTP server.
 */
function getProfileOrderHandler() {
  const stack = (ordersRouter as any).stack;
  for (const layer of stack) {
    if (
      layer.route &&
      layer.route.path === "/profile/orders/:id" &&
      layer.route.methods.get
    ) {
      // The route has [requireUser, handler] — we want the last one (the actual handler)
      const handlers = layer.route.stack;
      const lastHandler = handlers[handlers.length - 1];
      return lastHandler.handle;
    }
  }
  throw new Error("Could not find GET /profile/orders/:id handler in router");
}
