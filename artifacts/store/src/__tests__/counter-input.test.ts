import { describe, it, expect } from "vitest";
import { MAX_QUANTITY, addQuantity, computeChange, parseQuantity, resolveQuantityInput } from "../components/admin/counter/counter-input";

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

  describe("resolveQuantityInput", () => {
    it("commits a valid typed quantity", () => {
      expect(resolveQuantityInput("7", 3)).toEqual({ quantity: 7, rejected: false });
      expect(resolveQuantityInput(String(MAX_QUANTITY), 3)).toEqual({ quantity: MAX_QUANTITY, rejected: false });
    });

    it("reverts an invalid typed quantity to the current one and flags it as rejected", () => {
      for (const text of ["", "0", "-2", "2.5", "abc", "10000", "1e9"]) {
        expect(resolveQuantityInput(text, 3)).toEqual({ quantity: 3, rejected: true });
      }
    });
  });

  describe("addQuantity", () => {
    it("adds a scanned pack to the line", () => {
      expect(addQuantity(0, 1)).toBe(1);
      expect(addQuantity(3, 6)).toBe(9);
    });

    it("stops a repeatedly scanned line at the same cap a typed quantity has", () => {
      expect(MAX_QUANTITY).toBe(9999);
      expect(addQuantity(MAX_QUANTITY - 1, 1)).toBe(MAX_QUANTITY);
      expect(addQuantity(MAX_QUANTITY, 1)).toBe(MAX_QUANTITY);
      expect(addQuantity(MAX_QUANTITY - 2, 12)).toBe(MAX_QUANTITY);
      expect(addQuantity(0, 20000)).toBe(MAX_QUANTITY);
      expect(parseQuantity(String(addQuantity(MAX_QUANTITY, 12)))).toBe(MAX_QUANTITY);
    });
  });
});
