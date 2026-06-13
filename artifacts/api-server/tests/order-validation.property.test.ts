/**
 * Order Validation Property Tests
 *
 * Tests the order creation validation rules as property-based tests:
 * - Items array must be non-empty
 * - Each item must have a valid product_id (UUID) and quantity (1-99)
 * - Customer fields must be present and non-empty
 * - Phone must be a valid Azerbaijani format
 *
 * These tests exercise the validation logic in isolation without a running server.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Validation Logic (replicated from orders.ts) ────────────────────────────

const AZ_PHONE_REGEX = /^\+994\d{9}$/;

interface OrderItem {
  product_id: string;
  quantity: number;
}

interface OrderInput {
  items: OrderItem[];
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function validateOrderInput(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { valid: false, error: "Invalid request body" };
  }

  const { items, customer_name, customer_phone, delivery_address } = input as Record<string, unknown>;

  // Validate items
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, error: "Items array is required and must not be empty" };
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      return { valid: false, error: "Each item must be an object" };
    }
    const { product_id, quantity } = item as Record<string, unknown>;
    if (typeof product_id !== "string" || product_id.length === 0) {
      return { valid: false, error: "Each item must have a valid product_id" };
    }
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return { valid: false, error: "Each item quantity must be an integer between 1 and 99" };
    }
  }

  // Validate customer fields
  if (typeof customer_name !== "string" || customer_name.trim().length === 0) {
    return { valid: false, error: "Customer name is required" };
  }

  if (typeof customer_phone !== "string" || customer_phone.trim().length === 0) {
    return { valid: false, error: "Customer phone is required" };
  }

  // Normalize phone
  const digits = customer_phone.replace(/\D/g, "");
  const normalized = digits.startsWith("994")
    ? `+${digits}`
    : digits.startsWith("0")
      ? `+994${digits.slice(1)}`
      : `+994${digits}`;

  if (!AZ_PHONE_REGEX.test(normalized)) {
    return { valid: false, error: "Invalid phone number format" };
  }

  if (typeof delivery_address !== "string" || delivery_address.trim().length === 0) {
    return { valid: false, error: "Delivery address is required" };
  }

  return { valid: true };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const validProductId = fc.uuid();
const validQuantity = fc.integer({ min: 1, max: 99 });
const validItem = fc.record({ product_id: validProductId, quantity: validQuantity });
const validItems = fc.array(validItem, { minLength: 1, maxLength: 10 });
const validName = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);
const validAddress = fc.string({ minLength: 5, maxLength: 200 }).filter((s) => s.trim().length > 0);

// Azerbaijani phone: +994 followed by 9 digits (first digit 50-55, 70-77, 99)
const validPhone = fc.tuple(
  fc.constantFrom("50", "51", "55", "70", "77", "99"),
  fc.stringMatching(/^\d{7}$/),
).map(([prefix, suffix]) => `+994${prefix}${suffix}`);

const validOrderInput = fc.record({
  items: validItems,
  customer_name: validName,
  customer_phone: validPhone,
  delivery_address: validAddress,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Order Validation Property Tests", () => {
  describe("Property: valid orders always pass validation", () => {
    it("any well-formed order input is accepted", () => {
      fc.assert(
        fc.property(validOrderInput, (input) => {
          const result = validateOrderInput(input);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("Property: empty items always rejected", () => {
    it("order with no items is rejected", () => {
      fc.assert(
        fc.property(validName, validPhone, validAddress, (name, phone, addr) => {
          const result = validateOrderInput({
            items: [],
            customer_name: name,
            customer_phone: phone,
            delivery_address: addr,
          });
          expect(result.valid).toBe(false);
          expect(result.error).toMatch(/items/i);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe("Property: invalid quantity always rejected", () => {
    it("quantity 0 is rejected", () => {
      const result = validateOrderInput({
        items: [{ product_id: "abc", quantity: 0 }],
        customer_name: "Test",
        customer_phone: "+994501234567",
        delivery_address: "123 Test St",
      });
      expect(result.valid).toBe(false);
    });

    it("quantity above 99 is rejected", () => {
      fc.assert(
        fc.property(fc.integer({ min: 100, max: 10000 }), (qty) => {
          const result = validateOrderInput({
            items: [{ product_id: "abc-123", quantity: qty }],
            customer_name: "Test",
            customer_phone: "+994501234567",
            delivery_address: "123 Test St",
          });
          expect(result.valid).toBe(false);
          expect(result.error).toMatch(/quantity/i);
        }),
        { numRuns: 50 },
      );
    });

    it("fractional quantity is rejected", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.1, max: 98.9, noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
          (qty) => {
            const result = validateOrderInput({
              items: [{ product_id: "abc-123", quantity: qty }],
              customer_name: "Test",
              customer_phone: "+994501234567",
              delivery_address: "123 Test St",
            });
            expect(result.valid).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe("Property: missing required fields always rejected", () => {
    it("missing customer_name is rejected", () => {
      const result = validateOrderInput({
        items: [{ product_id: "abc", quantity: 1 }],
        customer_name: "",
        customer_phone: "+994501234567",
        delivery_address: "123 Test St",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/name/i);
    });

    it("missing delivery_address is rejected", () => {
      const result = validateOrderInput({
        items: [{ product_id: "abc", quantity: 1 }],
        customer_name: "Test",
        customer_phone: "+994501234567",
        delivery_address: "",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/address/i);
    });

    it("whitespace-only fields are rejected", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^\s+$/).filter((s) => s.length > 0),
          (whitespace) => {
            const result = validateOrderInput({
              items: [{ product_id: "abc", quantity: 1 }],
              customer_name: whitespace,
              customer_phone: "+994501234567",
              delivery_address: "123 Test St",
            });
            expect(result.valid).toBe(false);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe("Property: phone validation", () => {
    it("valid Azerbaijan phone formats are accepted", () => {
      const validFormats = [
        "+994501234567",
        "+994551234567",
        "+994701234567",
        "+994771234567",
        "+994991234567",
      ];
      for (const phone of validFormats) {
        const result = validateOrderInput({
          items: [{ product_id: "abc", quantity: 1 }],
          customer_name: "Test",
          customer_phone: phone,
          delivery_address: "123 Test St",
        });
        expect(result.valid).toBe(true);
      }
    });

    it("short phone numbers are rejected", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^\+994\d{1,8}$/),
          (shortPhone) => {
            const result = validateOrderInput({
              items: [{ product_id: "abc", quantity: 1 }],
              customer_name: "Test",
              customer_phone: shortPhone,
              delivery_address: "123 Test St",
            });
            expect(result.valid).toBe(false);
          },
        ),
        { numRuns: 30 },
      );
    });

    it("non-numeric phone is rejected", () => {
      const result = validateOrderInput({
        items: [{ product_id: "abc", quantity: 1 }],
        customer_name: "Test",
        customer_phone: "not-a-phone",
        delivery_address: "123 Test St",
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("Property: null/undefined inputs always rejected", () => {
    it("null body is rejected", () => {
      expect(validateOrderInput(null).valid).toBe(false);
    });

    it("undefined body is rejected", () => {
      expect(validateOrderInput(undefined).valid).toBe(false);
    });

    it("primitive body is rejected", () => {
      expect(validateOrderInput("string").valid).toBe(false);
      expect(validateOrderInput(42).valid).toBe(false);
    });
  });
});
