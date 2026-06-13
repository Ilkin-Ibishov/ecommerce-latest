import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BarcodeResult {
  title: string;
  images: string[];
}

// ---------------------------------------------------------------------------
// Barcode Validation
// ---------------------------------------------------------------------------

/**
 * Calculate the GS1 modulo-10 check digit for a numeric string.
 * Works for EAN-8, EAN-13, UPC-A (the last digit is the check digit).
 *
 * Algorithm:
 * 1. Starting from the rightmost digit (excluding check digit), alternate
 *    multipliers of 3 and 1 moving left.
 * 2. Sum all weighted digits.
 * 3. Check digit = (10 - (sum % 10)) % 10.
 */
function calculateCheckDigit(digits: string): number {
  const len = digits.length;
  let sum = 0;

  for (let i = 0; i < len - 1; i++) {
    const digit = Number(digits[i]);
    // For a barcode of length N, position from the right (excluding check digit)
    // determines the weight. The rightmost payload digit gets weight 3,
    // next gets 1, alternating.
    const posFromRight = len - 1 - i; // 1-based position from right
    const weight = posFromRight % 2 === 1 ? 3 : 1;
    sum += digit * weight;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * Validate that a string is a properly formatted barcode with a valid check digit.
 * Supports: EAN-8, EAN-13, UPC-A, UPC-E.
 */
export function validateBarcode(barcode: string): boolean {
  // Must be a non-empty string of digits only
  if (!barcode || !/^\d+$/.test(barcode)) {
    return false;
  }

  const len = barcode.length;

  switch (len) {
    case 8: {
      // Could be EAN-8 or UPC-E
      // EAN-8: any 8 digits with valid check digit
      // UPC-E: 8 digits starting with 0 or 1 with valid check digit
      // Both use the same check digit algorithm on 8 digits,
      // so we validate the check digit for 8-digit codes regardless
      return validateEan8OrUpcE(barcode);
    }
    case 12: {
      // UPC-A: exactly 12 digits with valid check digit
      return validateStandardCheckDigit(barcode);
    }
    case 13: {
      // EAN-13: exactly 13 digits with valid check digit
      return validateStandardCheckDigit(barcode);
    }
    default:
      return false;
  }
}

/**
 * Validate an 8-digit barcode (EAN-8 or UPC-E).
 * Both use the standard GS1 modulo-10 check digit on 8 digits.
 */
function validateEan8OrUpcE(barcode: string): boolean {
  return validateStandardCheckDigit(barcode);
}

/**
 * Validate a barcode using the standard GS1 modulo-10 check digit.
 * The last digit of the barcode is the check digit.
 */
function validateStandardCheckDigit(barcode: string): boolean {
  const expectedCheckDigit = calculateCheckDigit(barcode);
  const actualCheckDigit = Number(barcode[barcode.length - 1]);
  return expectedCheckDigit === actualCheckDigit;
}

// ---------------------------------------------------------------------------
// Barcode Lookup via UPCitemdb.com
// ---------------------------------------------------------------------------

const UPCITEMDB_API_URL = "https://api.upcitemdb.com/prod/trial/lookup";

/**
 * Look up a barcode via the UPCitemdb.com free trial API.
 * Returns the product title and associated image URLs, or null if not found.
 *
 * The free trial endpoint requires no API key but is limited to 100 requests/day.
 * Rate limiting should be handled externally (by the route handler using rate-limiter.ts).
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeResult | null> {
  if (!validateBarcode(barcode)) {
    return null;
  }

  try {
    const url = `${UPCITEMDB_API_URL}?upc=${encodeURIComponent(barcode)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "ecommerce-admin/1.0",
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        logger.warn({ barcode }, "UPCitemdb rate limit exceeded");
        throw new Error("Barcode lookup daily limit exceeded");
      }
      logger.warn(
        { barcode, status: response.status },
        "UPCitemdb API returned non-OK status"
      );
      return null;
    }

    const data = await response.json() as UpcItemDbResponse;

    if (!data.items || data.items.length === 0) {
      return null;
    }

    const item = data.items[0];
    const title = item.title || "";
    const images: string[] = [];

    // Collect images from the response, filtering for HTTPS only
    if (item.images && Array.isArray(item.images)) {
      for (const img of item.images) {
        if (typeof img === "string" && img.startsWith("https://")) {
          images.push(img);
        }
      }
    }

    if (!title && images.length === 0) {
      return null;
    }

    return { title, images };
  } catch (error) {
    // Re-throw rate limit errors so the route handler can return 429
    if (error instanceof Error && error.message.includes("daily limit")) {
      throw error;
    }

    logger.error(
      { barcode, error },
      "Failed to look up barcode via UPCitemdb"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// UPCitemdb API Response Types (internal)
// ---------------------------------------------------------------------------

interface UpcItemDbResponse {
  code: string;
  total: number;
  offset: number;
  items?: UpcItemDbItem[];
}

interface UpcItemDbItem {
  ean: string;
  title?: string;
  description?: string;
  brand?: string;
  images?: string[];
}
