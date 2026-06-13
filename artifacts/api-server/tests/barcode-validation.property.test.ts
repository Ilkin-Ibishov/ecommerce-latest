// Feature: product-image-management, Property 4: Barcode validation
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateBarcode } from "../src/lib/barcode-lookup";

/**
 * Property-Based Tests for Barcode Validation
 * Feature: product-image-management, Property 4: Barcode validation
 *
 * **Validates: Requirements 4.6**
 *
 * For any string, the barcode validator SHALL return true if and only if the string
 * is a valid EAN-8, EAN-13, UPC-A, or UPC-E format with a correct check digit.
 * All other strings SHALL be rejected.
 */

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calculate the GS1 modulo-10 check digit for a barcode.
 * Given N-1 payload digits, computes the Nth digit such that the full
 * N-digit string satisfies the GS1 check digit algorithm.
 *
 * Algorithm:
 * 1. Starting from the rightmost payload digit, alternate weights of 3 and 1.
 * 2. Sum all weighted digits.
 * 3. Check digit = (10 - (sum % 10)) % 10.
 */
function computeCheckDigit(payload: string, totalLength: number): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = Number(payload[i]);
    // Position from the right in the full barcode (1-based, excluding check digit position)
    const posFromRight = totalLength - 1 - i;
    const weight = posFromRight % 2 === 1 ? 3 : 1;
    sum += digit * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Corrupt a check digit by changing it to any other digit (0-9) that is NOT correct.
 */
function corruptCheckDigit(validBarcode: string): string {
  const lastDigit = Number(validBarcode[validBarcode.length - 1]);
  // Pick a different digit
  const wrongDigit = (lastDigit + 1 + Math.floor(Math.random() * 9)) % 10;
  return validBarcode.slice(0, -1) + String(wrongDigit);
}

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid EAN-8 barcode (8 digits with correct check digit) */
const validEan8Arb = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 7 })
  .map((digits) => {
    const payload = digits.join("");
    const checkDigit = computeCheckDigit(payload, 8);
    return payload + String(checkDigit);
  });

/** Generate a valid EAN-13 barcode (13 digits with correct check digit) */
const validEan13Arb = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 })
  .map((digits) => {
    const payload = digits.join("");
    const checkDigit = computeCheckDigit(payload, 13);
    return payload + String(checkDigit);
  });

/** Generate a valid UPC-A barcode (12 digits with correct check digit) */
const validUpcAArb = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 11, maxLength: 11 })
  .map((digits) => {
    const payload = digits.join("");
    const checkDigit = computeCheckDigit(payload, 12);
    return payload + String(checkDigit);
  });

/**
 * Generate a valid UPC-E barcode (8 digits starting with 0 or 1, correct check digit).
 * UPC-E uses the same GS1 check digit algorithm on 8 digits.
 */
const validUpcEArb = fc
  .tuple(
    fc.constantFrom(0, 1), // First digit must be 0 or 1
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 6, maxLength: 6 }),
  )
  .map(([first, rest]) => {
    const payload = String(first) + rest.join("");
    const checkDigit = computeCheckDigit(payload, 8);
    return payload + String(checkDigit);
  });

/** Generate a near-valid EAN-13 (correct length, all digits, but wrong check digit) */
const nearValidEan13Arb = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 })
  .map((digits) => {
    const payload = digits.join("");
    const correctCheck = computeCheckDigit(payload, 13);
    // Pick a different check digit
    const wrongCheck = (correctCheck + 1 + (digits[0] % 8)) % 10;
    return payload + String(wrongCheck);
  })
  .filter((barcode) => {
    // Ensure the check digit is actually wrong (filter guarantees it)
    const payload = barcode.slice(0, 12);
    const correctCheck = computeCheckDigit(payload, 13);
    return Number(barcode[12]) !== correctCheck;
  });

/** Generate a near-valid EAN-8 (correct length, all digits, but wrong check digit) */
const nearValidEan8Arb = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 7 })
  .map((digits) => {
    const payload = digits.join("");
    const correctCheck = computeCheckDigit(payload, 8);
    const wrongCheck = (correctCheck + 1 + (digits[0] % 8)) % 10;
    return payload + String(wrongCheck);
  })
  .filter((barcode) => {
    const payload = barcode.slice(0, 7);
    const correctCheck = computeCheckDigit(payload, 8);
    return Number(barcode[7]) !== correctCheck;
  });

/** Generate a near-valid UPC-A (correct length, all digits, but wrong check digit) */
const nearValidUpcAArb = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 11, maxLength: 11 })
  .map((digits) => {
    const payload = digits.join("");
    const correctCheck = computeCheckDigit(payload, 12);
    const wrongCheck = (correctCheck + 1 + (digits[0] % 8)) % 10;
    return payload + String(wrongCheck);
  })
  .filter((barcode) => {
    const payload = barcode.slice(0, 11);
    const correctCheck = computeCheckDigit(payload, 12);
    return Number(barcode[11]) !== correctCheck;
  });

/** Generate completely random strings (likely invalid barcodes) */
const randomStringArb = fc.string({ minLength: 0, maxLength: 30 });

/** Generate numeric strings with invalid lengths (not 8, 12, or 13) */
const invalidLengthNumericArb = fc
  .integer({ min: 1, max: 30 })
  .filter((len) => len !== 8 && len !== 12 && len !== 13)
  .chain((len) =>
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: len, maxLength: len })
      .map((digits) => digits.join(""))
  );

// ─── Property Tests ────────────────────────────────────────────────────────────

describe("Feature: product-image-management, Property 4: Barcode validation", () => {
  it("accepts any valid EAN-13 barcode (13 digits with correct check digit)", () => {
    fc.assert(
      fc.property(validEan13Arb, (barcode) => {
        expect(validateBarcode(barcode)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("accepts any valid EAN-8 barcode (8 digits with correct check digit)", () => {
    fc.assert(
      fc.property(validEan8Arb, (barcode) => {
        expect(validateBarcode(barcode)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("accepts any valid UPC-A barcode (12 digits with correct check digit)", () => {
    fc.assert(
      fc.property(validUpcAArb, (barcode) => {
        expect(validateBarcode(barcode)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("accepts any valid UPC-E barcode (8 digits starting with 0 or 1, correct check digit)", () => {
    fc.assert(
      fc.property(validUpcEArb, (barcode) => {
        expect(validateBarcode(barcode)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects random strings (non-numeric, wrong lengths, etc.)", () => {
    fc.assert(
      fc.property(randomStringArb, (str) => {
        // Random strings are overwhelmingly likely to be invalid barcodes.
        // If by chance the string happens to be a valid barcode, skip it.
        if (/^\d+$/.test(str) && [8, 12, 13].includes(str.length)) {
          // Could be a valid barcode by chance — verify with our own check
          const payload = str.slice(0, -1);
          const expectedCheck = computeCheckDigit(payload, str.length);
          if (expectedCheck === Number(str[str.length - 1])) {
            // Genuinely valid barcode — skip this case
            return;
          }
        }
        expect(validateBarcode(str)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects numeric strings with invalid lengths (not 8, 12, or 13)", () => {
    fc.assert(
      fc.property(invalidLengthNumericArb, (barcode) => {
        expect(validateBarcode(barcode)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects near-valid EAN-13 (correct length but wrong check digit)", () => {
    fc.assert(
      fc.property(nearValidEan13Arb, (barcode) => {
        expect(validateBarcode(barcode)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects near-valid EAN-8 (correct length but wrong check digit)", () => {
    fc.assert(
      fc.property(nearValidEan8Arb, (barcode) => {
        expect(validateBarcode(barcode)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects near-valid UPC-A (correct length but wrong check digit)", () => {
    fc.assert(
      fc.property(nearValidUpcAArb, (barcode) => {
        expect(validateBarcode(barcode)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("validates the check digit correctly: for any payload, appending the computed check digit yields a valid barcode", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(8, 12, 13),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 12 }),
        (targetLen, rawDigits) => {
          // Trim or pad digits to get the correct payload length
          const payloadLen = targetLen - 1;
          const payload = rawDigits
            .slice(0, payloadLen)
            .concat(Array(Math.max(0, payloadLen - rawDigits.length)).fill(0))
            .join("");
          const checkDigit = computeCheckDigit(payload, targetLen);
          const barcode = payload + String(checkDigit);
          expect(validateBarcode(barcode)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("flipping any single digit in a valid barcode produces an invalid barcode (most of the time)", () => {
    fc.assert(
      fc.property(
        validEan13Arb,
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 1, max: 9 }),
        (barcode, position, delta) => {
          // Flip one digit by adding delta mod 10
          const digits = barcode.split("").map(Number);
          digits[position] = (digits[position] + delta) % 10;
          const flipped = digits.join("");
          // If we happened to create another valid barcode (extremely rare), skip
          if (flipped === barcode) return;
          // The flipped barcode should be invalid (check digit mismatch)
          expect(validateBarcode(flipped)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
