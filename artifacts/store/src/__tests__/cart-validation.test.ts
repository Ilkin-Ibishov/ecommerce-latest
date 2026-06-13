/**
 * Cart Context — localStorage Validation Tests
 *
 * Tests the cart validation logic that sanitizes cart items loaded from localStorage.
 * This ensures tampered/corrupted data is properly rejected while valid items pass through.
 *
 * The cart context applies these rules on load:
 * - product_id must be a non-empty string
 * - slug must be a non-empty string
 * - title must be a non-empty string
 * - price must be a positive finite number
 * - quantity must be a positive integer <= 99
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Replicate the validation logic from cart/context.tsx
function isValidCartItem(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const i = item as Record<string, unknown>;
  if (typeof i.product_id !== "string" || !i.product_id) return false;
  if (typeof i.slug !== "string" || !i.slug) return false;
  if (typeof i.title !== "string" || !i.title) return false;
  if (typeof i.price !== "number" || i.price <= 0 || !isFinite(i.price)) return false;
  if (typeof i.quantity !== "number" || i.quantity <= 0 || i.quantity > 99 || !Number.isInteger(i.quantity)) return false;
  return true;
}

function filterValidItems(raw: unknown[]): unknown[] {
  return (Array.isArray(raw) ? raw : []).filter(isValidCartItem);
}

describe("Cart localStorage Validation", () => {
  describe("accepts valid items", () => {
    it("accepts a well-formed cart item", () => {
      const item = {
        product_id: "abc-123",
        slug: "test-product",
        title: "Test Product",
        price: 29.99,
        quantity: 2,
        image: null,
      };
      expect(isValidCartItem(item)).toBe(true);
    });

    it("accepts items with quantity 1 (minimum)", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: 0.01, quantity: 1 };
      expect(isValidCartItem(item)).toBe(true);
    });

    it("accepts items with quantity 99 (maximum)", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: 100, quantity: 99 };
      expect(isValidCartItem(item)).toBe(true);
    });

    it("property: any valid cart item passes validation", () => {
      fc.assert(
        fc.property(
          fc.record({
            product_id: fc.string({ minLength: 1, maxLength: 50 }),
            slug: fc.string({ minLength: 1, maxLength: 50 }),
            title: fc.string({ minLength: 1, maxLength: 200 }),
            price: fc.double({ min: 0.01, max: 99999, noNaN: true, noDefaultInfinity: true }),
            quantity: fc.integer({ min: 1, max: 99 }),
          }),
          (item) => {
            expect(isValidCartItem(item)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("rejects invalid items", () => {
    it("rejects null", () => {
      expect(isValidCartItem(null)).toBe(false);
    });

    it("rejects undefined", () => {
      expect(isValidCartItem(undefined)).toBe(false);
    });

    it("rejects non-object primitives", () => {
      expect(isValidCartItem("string")).toBe(false);
      expect(isValidCartItem(42)).toBe(false);
      expect(isValidCartItem(true)).toBe(false);
    });

    it("rejects empty product_id", () => {
      const item = { product_id: "", slug: "s", title: "T", price: 10, quantity: 1 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects empty slug", () => {
      const item = { product_id: "p1", slug: "", title: "T", price: 10, quantity: 1 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects empty title", () => {
      const item = { product_id: "p1", slug: "s", title: "", price: 10, quantity: 1 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects negative price", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: -5, quantity: 1 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects zero price", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: 0, quantity: 1 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects Infinity price", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: Infinity, quantity: 1 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects NaN price", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: NaN, quantity: 1 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects quantity zero", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: 10, quantity: 0 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects quantity above 99", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: 10, quantity: 100 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects fractional quantity", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: 10, quantity: 2.5 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("rejects negative quantity", () => {
      const item = { product_id: "p1", slug: "s", title: "T", price: 10, quantity: -1 };
      expect(isValidCartItem(item)).toBe(false);
    });

    it("property: items with invalid price always rejected", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(0),
            fc.double({ min: -99999, max: -0.01, noNaN: true, noDefaultInfinity: true }),
            fc.constant(NaN),
            fc.constant(Infinity),
            fc.constant(-Infinity),
          ),
          (badPrice) => {
            const item = { product_id: "p1", slug: "s", title: "T", price: badPrice, quantity: 1 };
            expect(isValidCartItem(item)).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it("property: items with invalid quantity always rejected", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(0),
            fc.integer({ min: -100, max: -1 }),
            fc.integer({ min: 100, max: 9999 }),
            fc.double({ min: 0.1, max: 98.9, noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
          ),
          (badQty) => {
            const item = { product_id: "p1", slug: "s", title: "T", price: 10, quantity: badQty };
            expect(isValidCartItem(item)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("filterValidItems", () => {
    it("filters out invalid items from a mixed array", () => {
      const raw = [
        { product_id: "p1", slug: "good", title: "Good", price: 10, quantity: 1 },
        { product_id: "", slug: "bad", title: "Bad", price: 10, quantity: 1 },
        null,
        { product_id: "p2", slug: "also-good", title: "Also Good", price: 5, quantity: 3 },
        "not an object",
      ];
      const result = filterValidItems(raw);
      expect(result).toHaveLength(2);
    });

    it("returns empty array for non-array input", () => {
      expect(filterValidItems("not array" as any)).toEqual([]);
      expect(filterValidItems(null as any)).toEqual([]);
    });

    it("returns empty array when all items are invalid", () => {
      const raw = [null, undefined, { price: -1 }, "garbage"];
      expect(filterValidItems(raw)).toEqual([]);
    });

    it("property: result length <= input length", () => {
      fc.assert(
        fc.property(
          fc.array(fc.anything(), { minLength: 0, maxLength: 50 }),
          (raw) => {
            const result = filterValidItems(raw);
            expect(result.length).toBeLessThanOrEqual(raw.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("property: all items in result pass validation", () => {
      fc.assert(
        fc.property(
          fc.array(fc.anything(), { minLength: 0, maxLength: 20 }),
          (raw) => {
            const result = filterValidItems(raw);
            for (const item of result) {
              expect(isValidCartItem(item)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
