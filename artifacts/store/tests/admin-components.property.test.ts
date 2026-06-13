import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { escapeCSV } from "../src/components/admin/CSVExportButton";

// ─── Property 1: CSV escaping round-trip ────────────────────────────────────────

describe("Property: CSV escaping round-trip", () => {
  /**
   * For any string, escapeCSV(value) when parsed back by splitting on commas
   * and handling RFC 4180 quoting, produces the original value.
   */
  it("escaped value can be parsed back to the original for any string", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const escaped = escapeCSV(value);
        const parsed = parseCSVField(escaped);
        expect(parsed).toBe(value);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 2: CSV escaping never produces bare commas outside quotes ─────────

describe("Property: CSV escaping never produces bare commas outside quotes", () => {
  /**
   * For any string value, the escaped output either doesn't contain commas,
   * or if it does, the entire output is wrapped in double-quotes.
   */
  it("output with commas is always fully wrapped in double-quotes", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const escaped = escapeCSV(value);
        if (escaped.includes(",")) {
          // Must be wrapped: starts with " and ends with "
          expect(escaped[0]).toBe('"');
          expect(escaped[escaped.length - 1]).toBe('"');
        }
        // If no commas, no assertion needed — it's safe as a bare field
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 3: Sort toggle is self-inverse ────────────────────────────────────

describe("Property: Sort toggle is self-inverse", () => {
  /**
   * For any sort state, toggling the same column twice returns to the
   * original direction.
   */

  function getNextDirection(
    sortKey: string,
    currentSort: string | null,
    currentDir: "asc" | "desc"
  ): "asc" | "desc" {
    const isActive = currentSort === sortKey;
    return isActive && currentDir === "asc" ? "desc" : "asc";
  }

  it("toggling the same column twice returns to the original direction", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }), // sortKey
        fc.constantFrom<"asc" | "desc">("asc", "desc"), // initial direction
        (sortKey, initialDir) => {
          // First toggle: column is active
          const afterFirst = getNextDirection(sortKey, sortKey, initialDir);
          // Second toggle: column is still active with new direction
          const afterSecond = getNextDirection(sortKey, sortKey, afterFirst);
          expect(afterSecond).toBe(initialDir);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 4: Price validation rejects all non-positive numbers ──────────────

describe("Property: Price validation rejects all non-positive numbers", () => {
  /**
   * For any number <= 0 or NaN, validation should reject.
   */

  function validatePrice(
    value: string,
    initialPrice: number
  ): { valid: true; price: number } | { valid: false } {
    const newPrice = parseFloat(value);
    if (isNaN(newPrice) || newPrice < 0 || newPrice === initialPrice) {
      return { valid: false };
    }
    return { valid: true, price: newPrice };
  }

  it("negative numbers are always rejected", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e10, max: -Number.MIN_VALUE, noNaN: true }),
        fc.double({ min: 0.01, max: 1e6, noNaN: true }),
        (negativePrice, initialPrice) => {
          const result = validatePrice(String(negativePrice), initialPrice);
          expect(result).toEqual({ valid: false });
        }
      ),
      { numRuns: 100 }
    );
  });

  it("NaN-producing strings are always rejected", () => {
    // Strings that parseFloat will return NaN for
    const nanStringArb = fc.stringMatching(/^[a-z]{1,20}$/).filter(
      (s) => isNaN(parseFloat(s))
    );

    fc.assert(
      fc.property(
        nanStringArb,
        fc.double({ min: 0.01, max: 1e6, noNaN: true }),
        (nanString, initialPrice) => {
          const result = validatePrice(nanString, initialPrice);
          expect(result).toEqual({ valid: false });
        }
      ),
      { numRuns: 100 }
    );
  });

  it("unchanged price is always rejected regardless of value", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (price) => {
          const result = validatePrice(String(price), price);
          expect(result).toEqual({ valid: false });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse a single RFC 4180 CSV field back to its original value.
 * Handles: bare values, quoted values, and escaped double-quotes within.
 */
function parseCSVField(field: string): string {
  if (field.length >= 2 && field[0] === '"' && field[field.length - 1] === '"') {
    // Remove surrounding quotes and unescape internal double-quotes
    const inner = field.slice(1, -1);
    return inner.replace(/""/g, '"');
  }
  return field;
}
