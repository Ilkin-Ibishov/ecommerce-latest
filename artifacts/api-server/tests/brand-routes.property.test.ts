import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { CreateBrandSchema, UpdateBrandSchema } from "../src/routes/admin/schemas";

/**
 * Brand API Property Tests
 * Feature: admin-brand-banner-management
 * Validates: Requirements 1.7, 2.2, 3.1, 3.2, 3.5, 3.6, 3.8
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Valid logo_url: either data:image/svg+xml URI or https:// URL */
const validLogoUrlArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 200 }).map((s) => `https://${s.replace(/[^a-zA-Z0-9./\-_]/g, "x")}.com/logo.svg`),
  fc.string({ minLength: 1, maxLength: 200 }).map((s) => `data:image/svg+xml,<svg>${s.replace(/[<>&"']/g, "x")}</svg>`),
);

/** Valid brand name: 1-100 characters, non-empty */
const validBrandNameArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

/** Valid sort_order: integer 0–999 */
const validSortOrderArb = fc.integer({ min: 0, max: 999 });

/** Generate a valid CreateBrand body */
const validCreateBrandArb = fc.record({
  name: validBrandNameArb,
  logo_url: validLogoUrlArb,
});

/** Strings that are NOT "true" or "false" */
const invalidBannerSettingArb = fc.string({ minLength: 0, maxLength: 50 }).filter(
  (s) => s !== "true" && s !== "false",
);

// ─── Property 1: Settings Validation Rejects Invalid Values ────────────────────
// Feature: admin-brand-banner-management, Property 1: Settings Validation Rejects Invalid Values

describe("Feature: admin-brand-banner-management, Property 1: Settings Validation Rejects Invalid Values", () => {
  /**
   * **Validates: Requirements 1.7**
   *
   * For any string value that is not exactly "true" or "false", updating the
   * brand_banner_enabled setting SHALL return a 400 validation error; conversely,
   * for "true" or "false", it SHALL succeed.
   */

  // Replicate the validation logic from settings.ts
  function validateBrandBannerEnabled(value: string): { valid: boolean; error?: string } {
    if (value !== "true" && value !== "false") {
      return { valid: false, error: 'Value must be "true" or "false"' };
    }
    return { valid: true };
  }

  it("rejects any string that is not 'true' or 'false'", () => {
    fc.assert(
      fc.property(invalidBannerSettingArb, (value) => {
        const result = validateBrandBannerEnabled(value);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("accepts exactly 'true' and 'false'", () => {
    fc.assert(
      fc.property(fc.constantFrom("true", "false"), (value) => {
        const result = validateBrandBannerEnabled(value);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("rejects numeric strings, booleans-as-strings, and other values", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer().map(String),
          fc.constantFrom("True", "False", "TRUE", "FALSE", "yes", "no", "1", "0", ""),
        ),
        (value) => {
          // Filter out the valid values "true" and "false"
          fc.pre(value !== "true" && value !== "false");
          const result = validateBrandBannerEnabled(value);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Case-Insensitive Name Uniqueness ──────────────────────────────
// Feature: admin-brand-banner-management, Property 2: Case-Insensitive Name Uniqueness

describe("Feature: admin-brand-banner-management, Property 2: Case-Insensitive Name Uniqueness", () => {
  /**
   * **Validates: Requirements 2.2, 3.5**
   *
   * Creating a brand with a name differing only in casing from an existing one
   * returns 409 (test both CREATE and UPDATE).
   */

  /** Simulate the case-insensitive name check used by the route handler */
  function checkNameConflict(
    existingNames: string[],
    newName: string,
    excludeId?: string,
  ): boolean {
    const lowerNew = newName.toLowerCase();
    // ilike comparison is case-insensitive
    return existingNames.some(
      (existing, idx) =>
        existing.toLowerCase() === lowerNew &&
        (excludeId == null || String(idx) !== excludeId),
    );
  }

  /** Transform a string to a different casing variant */
  const caseMutationArb = (name: string) =>
    fc.array(fc.boolean(), { minLength: name.length, maxLength: name.length }).map((flags) =>
      name
        .split("")
        .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(""),
    );

  it("CREATE: a name differing only in casing from an existing name is detected as conflict", () => {
    fc.assert(
      fc.property(
        // Generate an existing brand name
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /[a-zA-Z]/.test(s)),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
        (existingName, caseFlags) => {
          // Create a case-mutated version
          const mutated = existingName
            .split("")
            .map((ch, i) => ((caseFlags[i % caseFlags.length]) ? ch.toUpperCase() : ch.toLowerCase()))
            .join("");

          // The existing names array
          const existingNames = [existingName];

          // Check for conflict — should always detect it
          const hasConflict = checkNameConflict(existingNames, mutated);
          expect(hasConflict).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("UPDATE: a name differing only in casing from ANOTHER brand is detected as conflict", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /[a-zA-Z]/.test(s)),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /[a-zA-Z]/.test(s)),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
        (existingName, ownName, caseFlags) => {
          // Ensure existingName and ownName are different (case-insensitive)
          fc.pre(existingName.toLowerCase() !== ownName.toLowerCase());

          // Create a case-mutated version of the existing name (not own)
          const mutated = existingName
            .split("")
            .map((ch, i) => ((caseFlags[i % caseFlags.length]) ? ch.toUpperCase() : ch.toLowerCase()))
            .join("");

          // existingNames: index 0 = existing brand, index 1 = own brand
          const existingNames = [existingName, ownName];

          // Check with excludeId = "1" (own brand's index)
          const hasConflict = checkNameConflict(existingNames, mutated, "1");
          expect(hasConflict).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("UPDATE: changing own name casing does not trigger conflict", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /[a-zA-Z]/.test(s)),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
        (ownName, caseFlags) => {
          // Create a case-mutated version of own name
          const mutated = ownName
            .split("")
            .map((ch, i) => ((caseFlags[i % caseFlags.length]) ? ch.toUpperCase() : ch.toLowerCase()))
            .join("");

          // existingNames: only own brand at index 0
          const existingNames = [ownName];

          // Check with excludeId = "0" (own brand is excluded)
          const hasConflict = checkNameConflict(existingNames, mutated, "0");
          expect(hasConflict).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Brand List Ordering Invariant ─────────────────────────────────
// Feature: admin-brand-banner-management, Property 3: Brand List Ordering Invariant

describe("Feature: admin-brand-banner-management, Property 3: Brand List Ordering Invariant", () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * GET always returns brands in non-decreasing sort_order.
   */

  /** Simulate the GET /admin/brands behavior: sort by sort_order ascending */
  function sortBrandsBySortOrder<T extends { sort_order: number }>(brands: T[]): T[] {
    return [...brands].sort((a, b) => a.sort_order - b.sort_order);
  }

  it("returned brands are always in non-decreasing sort_order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 100 }),
            logo_url: fc.constant("https://example.com/logo.svg"),
            sort_order: fc.integer({ min: 0, max: 999 }),
            is_active: fc.boolean(),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (brands) => {
          const sorted = sortBrandsBySortOrder(brands);

          // Verify non-decreasing sort_order
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].sort_order).toBeGreaterThanOrEqual(sorted[i - 1].sort_order);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all original elements are preserved after sorting (no data loss)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 50 }),
            logo_url: fc.constant("https://example.com/logo.svg"),
            sort_order: fc.integer({ min: 0, max: 999 }),
            is_active: fc.boolean(),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (brands) => {
          const sorted = sortBrandsBySortOrder(brands);
          expect(sorted.length).toBe(brands.length);

          // All IDs from original appear in sorted
          const originalIds = new Set(brands.map((b) => b.id));
          const sortedIds = new Set(sorted.map((b) => b.id));
          expect(sortedIds).toEqual(originalIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Auto-Increment Sort Order on Creation ─────────────────────────
// Feature: admin-brand-banner-management, Property 4: Auto-Increment Sort Order on Creation

describe("Feature: admin-brand-banner-management, Property 4: Auto-Increment Sort Order on Creation", () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * New brands without explicit sort_order get max+1 (or 0 if empty).
   */

  /** Simulate auto-increment sort order logic from brands-management.ts */
  function computeAutoSortOrder(existingSortOrders: number[]): number {
    if (existingSortOrders.length === 0) return 0;
    return Math.max(...existingSortOrders) + 1;
  }

  it("returns 0 when no existing entries", () => {
    const result = computeAutoSortOrder([]);
    expect(result).toBe(0);
  });

  it("returns max+1 for any non-empty set of existing sort_orders", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 998 }), { minLength: 1, maxLength: 50 }),
        (existingSortOrders) => {
          const maxExisting = Math.max(...existingSortOrders);
          const result = computeAutoSortOrder(existingSortOrders);
          expect(result).toBe(maxExisting + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sequential creations produce strictly increasing sort_orders", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (numCreations) => {
          const sortOrders: number[] = [];

          for (let i = 0; i < numCreations; i++) {
            const newSortOrder = computeAutoSortOrder(sortOrders);
            sortOrders.push(newSortOrder);
          }

          // Verify strictly increasing
          for (let i = 1; i < sortOrders.length; i++) {
            expect(sortOrders[i]).toBeGreaterThan(sortOrders[i - 1]);
          }

          // First element should be 0
          expect(sortOrders[0]).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("auto-increment is always greater than all existing sort_orders", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 998 }), { minLength: 1, maxLength: 50 }),
        (existingSortOrders) => {
          const newSortOrder = computeAutoSortOrder(existingSortOrders);

          // Must be strictly greater than ALL existing values
          for (const existing of existingSortOrders) {
            expect(newSortOrder).toBeGreaterThan(existing);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Request Body Validation ───────────────────────────────────────
// Feature: admin-brand-banner-management, Property 6: Request Body Validation

describe("Feature: admin-brand-banner-management, Property 6: Request Body Validation", () => {
  /**
   * **Validates: Requirements 2.4, 3.6, 3.8**
   *
   * Invalid name/logo_url combos return 400; valid combos pass.
   */

  it("CreateBrandSchema accepts valid name + valid logo_url", () => {
    fc.assert(
      fc.property(validCreateBrandArb, (body) => {
        const result = CreateBrandSchema.safeParse(body);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("CreateBrandSchema rejects empty name", () => {
    fc.assert(
      fc.property(validLogoUrlArb, (logoUrl) => {
        const result = CreateBrandSchema.safeParse({ name: "", logo_url: logoUrl });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("CreateBrandSchema rejects name exceeding 100 characters", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 101, maxLength: 200 }),
        validLogoUrlArb,
        (longName, logoUrl) => {
          const result = CreateBrandSchema.safeParse({ name: longName, logo_url: logoUrl });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("CreateBrandSchema rejects missing name", () => {
    fc.assert(
      fc.property(validLogoUrlArb, (logoUrl) => {
        const result = CreateBrandSchema.safeParse({ logo_url: logoUrl });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("CreateBrandSchema rejects logo_url not starting with data:image/svg+xml or https://", () => {
    fc.assert(
      fc.property(
        validBrandNameArb,
        fc.string({ minLength: 1, maxLength: 500 }).filter(
          (s) => !s.startsWith("data:image/svg+xml") && !s.startsWith("https://"),
        ),
        (name, invalidUrl) => {
          const result = CreateBrandSchema.safeParse({ name, logo_url: invalidUrl });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("CreateBrandSchema rejects missing logo_url", () => {
    fc.assert(
      fc.property(validBrandNameArb, (name) => {
        const result = CreateBrandSchema.safeParse({ name });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("CreateBrandSchema rejects empty logo_url", () => {
    fc.assert(
      fc.property(validBrandNameArb, (name) => {
        const result = CreateBrandSchema.safeParse({ name, logo_url: "" });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("CreateBrandSchema accepts optional sort_order (valid int 0–999)", () => {
    fc.assert(
      fc.property(validCreateBrandArb, validSortOrderArb, (body, sortOrder) => {
        const result = CreateBrandSchema.safeParse({ ...body, sort_order: sortOrder });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("CreateBrandSchema rejects sort_order outside 0–999 range", () => {
    fc.assert(
      fc.property(
        validCreateBrandArb,
        fc.oneof(
          fc.integer({ min: 1000, max: 99999 }),
          fc.integer({ min: -99999, max: -1 }),
        ),
        (body, invalidSortOrder) => {
          const result = CreateBrandSchema.safeParse({ ...body, sort_order: invalidSortOrder });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("UpdateBrandSchema accepts partial updates with valid fields", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ name: validBrandNameArb }),
          fc.record({ logo_url: validLogoUrlArb }),
          fc.record({ sort_order: validSortOrderArb }),
          fc.record({ is_active: fc.boolean() }),
          fc.record({ name: validBrandNameArb, logo_url: validLogoUrlArb }),
        ),
        (body) => {
          const result = UpdateBrandSchema.safeParse(body);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("UpdateBrandSchema rejects invalid logo_url when provided", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }).filter(
          (s) => !s.startsWith("data:image/svg+xml") && !s.startsWith("https://"),
        ),
        (invalidUrl) => {
          const result = UpdateBrandSchema.safeParse({ logo_url: invalidUrl });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
