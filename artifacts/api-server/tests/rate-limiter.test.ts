import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkDailyLimit,
  incrementDailyCount,
  _resetCounters,
  _getCount,
} from "../src/lib/rate-limiter.ts";

describe("rate-limiter", () => {
  beforeEach(() => {
    _resetCounters();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkDailyLimit", () => {
    it("returns true when no calls have been made", async () => {
      const allowed = await checkDailyLimit("barcode-lookup", 100);
      expect(allowed).toBe(true);
    });

    it("returns true when count is below the limit", async () => {
      // Simulate some calls
      for (let i = 0; i < 50; i++) {
        await incrementDailyCount("barcode-lookup");
      }
      const allowed = await checkDailyLimit("barcode-lookup", 100);
      expect(allowed).toBe(true);
    });

    it("returns false when count has reached the limit", async () => {
      for (let i = 0; i < 100; i++) {
        await incrementDailyCount("barcode-lookup");
      }
      const allowed = await checkDailyLimit("barcode-lookup", 100);
      expect(allowed).toBe(false);
    });

    it("returns false when count exceeds the limit", async () => {
      for (let i = 0; i < 105; i++) {
        await incrementDailyCount("barcode-lookup");
      }
      const allowed = await checkDailyLimit("barcode-lookup", 100);
      expect(allowed).toBe(false);
    });

    it("tracks services independently", async () => {
      for (let i = 0; i < 5; i++) {
        await incrementDailyCount("service-a");
      }
      const allowedA = await checkDailyLimit("service-a", 5);
      const allowedB = await checkDailyLimit("service-b", 5);

      expect(allowedA).toBe(false);
      expect(allowedB).toBe(true);
    });
  });

  describe("incrementDailyCount", () => {
    it("increments the counter by 1", async () => {
      await incrementDailyCount("barcode-lookup");
      expect(_getCount("barcode-lookup")).toBe(1);

      await incrementDailyCount("barcode-lookup");
      expect(_getCount("barcode-lookup")).toBe(2);
    });

    it("initializes the counter if not present", async () => {
      expect(_getCount("new-service")).toBe(0);
      await incrementDailyCount("new-service");
      expect(_getCount("new-service")).toBe(1);
    });
  });

  describe("daily reset behavior", () => {
    it("resets counter when the date changes", async () => {
      // Increment counter to the limit
      for (let i = 0; i < 100; i++) {
        await incrementDailyCount("barcode-lookup");
      }
      expect(await checkDailyLimit("barcode-lookup", 100)).toBe(false);

      // Simulate date change by mocking Date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      vi.useFakeTimers();
      vi.setSystemTime(tomorrow);

      // Counter should reset on next access
      expect(await checkDailyLimit("barcode-lookup", 100)).toBe(true);
      expect(_getCount("barcode-lookup")).toBe(0);

      vi.useRealTimers();
    });
  });

  describe("edge cases", () => {
    it("handles maxPerDay of 0 (always blocked)", async () => {
      const allowed = await checkDailyLimit("strict-service", 0);
      expect(allowed).toBe(false);
    });

    it("handles maxPerDay of 1 (single call allowed)", async () => {
      expect(await checkDailyLimit("single-service", 1)).toBe(true);
      await incrementDailyCount("single-service");
      expect(await checkDailyLimit("single-service", 1)).toBe(false);
    });
  });
});
