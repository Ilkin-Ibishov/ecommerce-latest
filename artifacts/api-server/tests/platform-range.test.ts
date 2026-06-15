// Feature: super-admin-platform — unit tests for lib/platform/range.ts
// Requirements: 2.5, 2.6, 2.7

import { describe, it, expect } from "vitest";
import { validateTimeRange } from "../src/lib/platform/range";

describe("validateTimeRange", () => {
  const fixedNow = new Date("2024-06-15T12:00:00.000Z");

  describe("default range when both absent", () => {
    it("returns last 30 days when both from and to are undefined", () => {
      const result = validateTimeRange({}, fixedNow);
      expect(result).toEqual({
        valid: true,
        from: "2024-05-16",
        to: "2024-06-15",
      });
    });

    it("returns last 30 days when both are null", () => {
      const result = validateTimeRange({ from: null, to: null }, fixedNow);
      expect(result).toEqual({
        valid: true,
        from: "2024-05-16",
        to: "2024-06-15",
      });
    });

    it("returns last 30 days when both are empty strings", () => {
      const result = validateTimeRange({ from: "", to: "" }, fixedNow);
      expect(result).toEqual({
        valid: true,
        from: "2024-05-16",
        to: "2024-06-15",
      });
    });
  });

  describe("one endpoint missing", () => {
    it("rejects when from is present but to is missing", () => {
      const result = validateTimeRange({ from: "2024-01-01" }, fixedNow);
      expect(result).toEqual({
        valid: false,
        error:
          "Both from and to are required when a time range is specified",
      });
    });

    it("rejects when to is present but from is missing", () => {
      const result = validateTimeRange({ to: "2024-06-01" }, fixedNow);
      expect(result).toEqual({
        valid: false,
        error:
          "Both from and to are required when a time range is specified",
      });
    });

    it("rejects when from is present and to is null", () => {
      const result = validateTimeRange(
        { from: "2024-01-01", to: null },
        fixedNow,
      );
      expect(result).toEqual({
        valid: false,
        error:
          "Both from and to are required when a time range is specified",
      });
    });
  });

  describe("invalid date formats", () => {
    it("rejects non-date from", () => {
      const result = validateTimeRange(
        { from: "not-a-date", to: "2024-06-01" },
        fixedNow,
      );
      expect(result).toEqual({
        valid: false,
        error: "Invalid date format for from/to",
      });
    });

    it("rejects non-date to", () => {
      const result = validateTimeRange(
        { from: "2024-01-01", to: "xyz" },
        fixedNow,
      );
      expect(result).toEqual({
        valid: false,
        error: "Invalid date format for from/to",
      });
    });

    it("rejects both invalid dates", () => {
      const result = validateTimeRange(
        { from: "abc", to: "def" },
        fixedNow,
      );
      expect(result).toEqual({
        valid: false,
        error: "Invalid date format for from/to",
      });
    });
  });

  describe("start > end", () => {
    it("rejects when from is after to", () => {
      const result = validateTimeRange(
        { from: "2024-06-15", to: "2024-06-01" },
        fixedNow,
      );
      expect(result).toEqual({
        valid: false,
        error: "Time range start must not be after end",
      });
    });
  });

  describe("range exceeds 366 days", () => {
    it("rejects a range of exactly 367 days", () => {
      const result = validateTimeRange(
        { from: "2023-01-01", to: "2024-01-03" },
        fixedNow,
      );
      expect(result).toEqual({
        valid: false,
        error: "Time range must not exceed 366 days",
      });
    });

    it("accepts a range of exactly 366 days", () => {
      const result = validateTimeRange(
        { from: "2023-01-01", to: "2024-01-02" },
        fixedNow,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("valid range", () => {
    it("returns inclusive endpoints for a valid range", () => {
      const result = validateTimeRange(
        { from: "2024-03-01", to: "2024-06-01" },
        fixedNow,
      );
      expect(result).toEqual({
        valid: true,
        from: "2024-03-01",
        to: "2024-06-01",
      });
    });

    it("accepts same-day range (from === to)", () => {
      const result = validateTimeRange(
        { from: "2024-06-15", to: "2024-06-15" },
        fixedNow,
      );
      expect(result).toEqual({
        valid: true,
        from: "2024-06-15",
        to: "2024-06-15",
      });
    });

    it("normalizes full ISO datetime to date-only", () => {
      const result = validateTimeRange(
        {
          from: "2024-03-01T10:30:00.000Z",
          to: "2024-06-01T23:59:59.999Z",
        },
        fixedNow,
      );
      expect(result).toEqual({
        valid: true,
        from: "2024-03-01",
        to: "2024-06-01",
      });
    });
  });
});
