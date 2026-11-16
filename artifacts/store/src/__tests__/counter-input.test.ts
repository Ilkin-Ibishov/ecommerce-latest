import { describe, it, expect } from "vitest";
import { computeChange, parseQuantity } from "../components/admin/counter/counter-input";

describe("counter-input", () => {
  describe("computeChange", () => {
    it("computes change when tendered exceeds total", () => {
      expect(computeChange("20", 19)).toEqual({ sufficient: true, change: 1 });
    });

    it("computes zero change when exact amount tendered", () => {
      expect(computeChange("19", 19)).toEqual({ sufficient: true, change: 0 });
    });

    it("reports insufficient when tendered is less than total", () => {
      const res = computeChange("18.99", 19);
      expect(res.sufficient).toBe(false);
    });

    it("reports insufficient and zero change for empty or non-numeric input", () => {
      expect(computeChange("", 19)).toEqual({ sufficient: false, change: 0 });
      expect(computeChange("abc", 19)).toEqual({ sufficient: false, change: 0 });
    });

    it("handles float cases accurately without precision errors", () => {
      expect(computeChange("0.3", 0.1)).toEqual({ sufficient: true, change: 0.2 });
    });

    it("accepts number arguments equivalent to strings", () => {
      expect(computeChange(20, 19)).toEqual({ sufficient: true, change: 1 });
      expect(computeChange(19, 19)).toEqual({ sufficient: true, change: 0 });
      expect(computeChange(18.99, 19).sufficient).toBe(false);
      expect(computeChange(0.3, 0.1)).toEqual({ sufficient: true, change: 0.2 });
    });
  });

  describe("parseQuantity", () => {
    it("parses valid positive integer quantities within bounds", () => {
      expect(parseQuantity("1")).toBe(1);
      expect(parseQuantity("12")).toBe(12);
      expect(parseQuantity("9999")).toBe(9999);
    });

    it("rejects invalid, empty, out-of-range, or non-integer inputs", () => {
      expect(parseQuantity("2.5")).toBeNull();
      expect(parseQuantity("")).toBeNull();
      expect(parseQuantity("0")).toBeNull();
      expect(parseQuantity("-1")).toBeNull();
      expect(parseQuantity("abc")).toBeNull();
      expect(parseQuantity("1e9")).toBeNull();
      expect(parseQuantity("10000")).toBeNull();
    });
  });
});
