import { describe, it, expect } from "vitest";
import { validateBarcode } from "../src/lib/barcode-lookup";

/**
 * Unit tests for barcode validation.
 * Feature: product-image-management
 * Validates: Requirements 4.1, 4.6
 */

describe("validateBarcode", () => {
  describe("EAN-13 validation", () => {
    it("accepts a valid EAN-13 barcode", () => {
      // 4006381333931 is a well-known valid EAN-13
      expect(validateBarcode("4006381333931")).toBe(true);
    });

    it("accepts EAN-13: 5901234123457", () => {
      expect(validateBarcode("5901234123457")).toBe(true);
    });

    it("accepts EAN-13: 4003994155486", () => {
      expect(validateBarcode("4003994155486")).toBe(true);
    });

    it("rejects EAN-13 with wrong check digit", () => {
      // Correct is 4006381333931, change last digit
      expect(validateBarcode("4006381333932")).toBe(false);
    });

    it("rejects EAN-13 with all same digits (invalid check)", () => {
      // 1111111111111 — check digit should be 2, not 1
      expect(validateBarcode("1111111111111")).toBe(false);
    });
  });

  describe("EAN-8 validation", () => {
    it("accepts a valid EAN-8 barcode", () => {
      // 96385074 is a valid EAN-8
      expect(validateBarcode("96385074")).toBe(true);
    });

    it("accepts EAN-8: 65833254", () => {
      expect(validateBarcode("65833254")).toBe(true);
    });

    it("rejects EAN-8 with wrong check digit", () => {
      expect(validateBarcode("96385075")).toBe(false);
    });
  });

  describe("UPC-A validation", () => {
    it("accepts a valid UPC-A barcode", () => {
      // 042100005264 is a valid UPC-A
      expect(validateBarcode("042100005264")).toBe(true);
    });

    it("accepts UPC-A: 012345678905", () => {
      expect(validateBarcode("012345678905")).toBe(true);
    });

    it("accepts UPC-A: 123456789012", () => {
      expect(validateBarcode("123456789012")).toBe(true);
    });

    it("rejects UPC-A with wrong check digit", () => {
      expect(validateBarcode("042100005265")).toBe(false);
    });
  });

  describe("UPC-E validation", () => {
    it("accepts a valid UPC-E barcode (starts with 0)", () => {
      // 04252610 — check digit: sum=30, (10-30%10)%10=0
      expect(validateBarcode("04252610")).toBe(true);
    });

    it("accepts UPC-E: 01234565", () => {
      expect(validateBarcode("01234565")).toBe(true);
    });

    it("rejects UPC-E with wrong check digit", () => {
      expect(validateBarcode("04252615")).toBe(false);
    });
  });

  describe("Invalid inputs", () => {
    it("rejects empty string", () => {
      expect(validateBarcode("")).toBe(false);
    });

    it("rejects non-numeric string", () => {
      expect(validateBarcode("abcdefgh")).toBe(false);
    });

    it("rejects mixed alphanumeric", () => {
      expect(validateBarcode("123456789A12")).toBe(false);
    });

    it("rejects too short (< 8 digits)", () => {
      expect(validateBarcode("1234567")).toBe(false);
    });

    it("rejects 9-digit string (invalid length)", () => {
      expect(validateBarcode("123456789")).toBe(false);
    });

    it("rejects 10-digit string (invalid length)", () => {
      expect(validateBarcode("1234567890")).toBe(false);
    });

    it("rejects 11-digit string (invalid length)", () => {
      expect(validateBarcode("12345678901")).toBe(false);
    });

    it("rejects 14-digit string (invalid length)", () => {
      expect(validateBarcode("12345678901234")).toBe(false);
    });

    it("rejects string with spaces", () => {
      expect(validateBarcode("4006 3813 3393 1")).toBe(false);
    });

    it("rejects string with dashes", () => {
      expect(validateBarcode("4006-3813-3393-1")).toBe(false);
    });

    it("rejects string with leading/trailing whitespace", () => {
      expect(validateBarcode(" 4006381333931 ")).toBe(false);
    });
  });
});
