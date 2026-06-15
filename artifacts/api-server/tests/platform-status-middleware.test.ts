import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  platformStatus,
  resetPlatformStatusCache,
  refreshPlatformStatusCache,
} from "../src/middlewares/platformStatus";
import type { Request, Response, NextFunction } from "express";

// Feature: super-admin-platform
// Unit tests for middlewares/platformStatus.ts (Task 4.3)
// Validates: Requirements 3.3, 3.4, 5.5

function mockReq(): Request {
  return {} as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  } as unknown as Response & { statusCode: number; body: unknown };
  return res;
}

describe("platformStatus middleware", () => {
  beforeEach(() => {
    resetPlatformStatusCache();
    // Set env vars so fetch won't run (no URL configured = unreachable)
    vi.stubEnv("PLATFORM_STATUS_URL", "");
    vi.stubEnv("STORE_ID", "");
    vi.stubEnv("STORE_PLATFORM_SECRET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPlatformStatusCache();
  });

  describe("fail-safe to active when no cache and CP unreachable", () => {
    it("allows storefront_read when no cache and no CP URL", async () => {
      const middleware = platformStatus("storefront_read");
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it("allows admin_write when no cache and no CP URL", async () => {
      const middleware = platformStatus("admin_write");
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it("allows order_submit when no cache and no CP URL", async () => {
      const middleware = platformStatus("order_submit");
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe("gate behavior with mock fetch", () => {
    it("blocks storefront_read with 503 when status is suspended", async () => {
      // Mock fetch to return suspended
      vi.stubEnv("PLATFORM_STATUS_URL", "http://localhost:9999/platform/store-status");
      vi.stubEnv("STORE_ID", "store-1");
      vi.stubEnv("STORE_PLATFORM_SECRET", "secret");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platform_status: "suspended" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      // Force a synchronous refresh so the cache is populated
      await refreshPlatformStatusCache();

      const middleware = platformStatus("storefront_read");
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: "Store is temporarily unavailable" });

      vi.unstubAllGlobals();
    });

    it("blocks admin_write with 403 when status is suspended", async () => {
      vi.stubEnv("PLATFORM_STATUS_URL", "http://localhost:9999/platform/store-status");
      vi.stubEnv("STORE_ID", "store-1");
      vi.stubEnv("STORE_PLATFORM_SECRET", "secret");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platform_status: "suspended" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await refreshPlatformStatusCache();

      const middleware = platformStatus("admin_write");
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: "Store is suspended, write operations are blocked",
      });

      vi.unstubAllGlobals();
    });

    it("allows admin_read when status is suspended", async () => {
      vi.stubEnv("PLATFORM_STATUS_URL", "http://localhost:9999/platform/store-status");
      vi.stubEnv("STORE_ID", "store-1");
      vi.stubEnv("STORE_PLATFORM_SECRET", "secret");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platform_status: "suspended" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await refreshPlatformStatusCache();

      const middleware = platformStatus("admin_read");
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();

      vi.unstubAllGlobals();
    });

    it("blocks order_submit with 403 when status is suspended", async () => {
      vi.stubEnv("PLATFORM_STATUS_URL", "http://localhost:9999/platform/store-status");
      vi.stubEnv("STORE_ID", "store-1");
      vi.stubEnv("STORE_PLATFORM_SECRET", "secret");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platform_status: "suspended" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await refreshPlatformStatusCache();

      const middleware = platformStatus("order_submit");
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);

      vi.unstubAllGlobals();
    });

    it("blocks all operations with 403 when status is disabled", async () => {
      vi.stubEnv("PLATFORM_STATUS_URL", "http://localhost:9999/platform/store-status");
      vi.stubEnv("STORE_ID", "store-1");
      vi.stubEnv("STORE_PLATFORM_SECRET", "secret");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platform_status: "disabled" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await refreshPlatformStatusCache();

      for (const op of [
        "admin_read",
        "admin_write",
        "storefront_read",
        "order_submit",
      ] as const) {
        const middleware = platformStatus(op);
        const req = mockReq();
        const res = mockRes();
        const next = vi.fn() as unknown as NextFunction;

        await middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
      }

      vi.unstubAllGlobals();
    });

    it("allows all operations when status is active", async () => {
      vi.stubEnv("PLATFORM_STATUS_URL", "http://localhost:9999/platform/store-status");
      vi.stubEnv("STORE_ID", "store-1");
      vi.stubEnv("STORE_PLATFORM_SECRET", "secret");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platform_status: "active" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await refreshPlatformStatusCache();

      for (const op of [
        "admin_read",
        "admin_write",
        "storefront_read",
        "order_submit",
      ] as const) {
        const middleware = platformStatus(op);
        const req = mockReq();
        const res = mockRes();
        const next = vi.fn() as unknown as NextFunction;

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
      }

      vi.unstubAllGlobals();
    });
  });

  describe("cache TTL and background refresh", () => {
    it("uses cached value when cache is fresh (no new fetch)", async () => {
      vi.stubEnv("PLATFORM_STATUS_URL", "http://localhost:9999/platform/store-status");
      vi.stubEnv("STORE_ID", "store-1");
      vi.stubEnv("STORE_PLATFORM_SECRET", "secret");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platform_status: "active" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      // Populate cache
      await refreshPlatformStatusCache();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Now calling middleware should NOT trigger another fetch
      const middleware = platformStatus("storefront_read");
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      // No new fetch call — still just 1
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });
});
