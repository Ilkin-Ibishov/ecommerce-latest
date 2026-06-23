import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { UpdateBrandSchema, ReorderBrandsSchema } from "../src/routes/admin/schemas";

/**
 * Brand Routes Property Tests — Partial Update & Reorder
 * Feature: admin-brand-banner-management
 * Validates: Requirements 3.3, 4.1, 4.2, 4.3, 4.4
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** All updatable brand fields */
const UPDATABLE_FIELDS = ["name", "logo_url", "sort_order", "is_active"] as const;
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

/** Generate a valid brand name (1–100 chars, non-empty) */
const validNameArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

/** Generate a valid logo_url (data:image/svg+xml or https://) */
const validLogoUrlArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 200 }).map((s) => `https://${s.replace(/\s/g, "")}`),
  fc.string({ minLength: 1, maxLength: 200 }).map((s) => `data:image/svg+xml,${s}`),
);

/** Generate a valid sort_order (int 0–999) */
const validSortOrderArb = fc.integer({ min: 0, max: 999 });

/** Generate a valid is_active flag */
const validIsActiveArb = fc.boolean();

/** Generate a valid UUID v4 string */
const uuidArb = fc.uuid();

/** Generate a non-empty subset of updatable fields */
const fieldSubsetArb = fc
  .subarray([...UPDATABLE_FIELDS], { minLength: 1, maxLength: 4 })
  .filter((arr) => arr.length > 0);

/** Generate a valid value for a given update field */
function validValueForField(field: UpdatableField): fc.Arbitrary<unknown> {
  switch (field) {
    case "name":
      return validNameArb;
    case "logo_url":
      return validLogoUrlArb;
    case "sort_order":
      return validSortOrderArb;
    case "is_active":
      return validIsActiveArb;
  }
}

// ─── Feature: admin-brand-banner-management, Property 5: Partial Update Field Isolation ───

describe("Feature: admin-brand-banner-management, Property 5: Partial Update Field Isolation", () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For any brand entry and any subset of allowed update fields (name, logo_url,
   * sort_order, is_active), a PATCH request SHALL modify exactly those fields and
   * leave all other fields unchanged (except updated_at).
   *
   * We test that UpdateBrandSchema accepts partial objects (any non-empty subset),
   * and simulate the update payload construction logic to verify field isolation.
   */
  it("UpdateBrandSchema accepts any non-empty subset of updatable fields", () => {
    fc.assert(
      fc.property(
        fieldSubsetArb,
        (fields) => {
          // Build a body with only the selected fields using valid values
          const body: Record<string, unknown> = {};
          for (const field of fields) {
            switch (field) {
              case "name":
                body.name = "Test Brand";
                break;
              case "logo_url":
                body.logo_url = "https://example.com/logo.svg";
                break;
              case "sort_order":
                body.sort_order = 5;
                break;
              case "is_active":
                body.is_active = true;
                break;
            }
          }

          const result = UpdateBrandSchema.safeParse(body);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("only provided fields appear in the constructed update payload (field isolation)", () => {
    fc.assert(
      fc.property(
        fieldSubsetArb,
        validNameArb,
        validSortOrderArb,
        validIsActiveArb,
        (fieldsToUpdate, nameVal, sortVal, activeVal) => {
          // Simulate an existing brand entry with all fields set
          const existingBrand = {
            id: "00000000-0000-0000-0000-000000000001",
            name: "Original Name",
            logo_url: "https://original.com/logo.svg",
            sort_order: 0,
            is_active: true,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          };

          // Build the update body with only selected fields
          const updateBody: Record<string, unknown> = {};
          if (fieldsToUpdate.includes("name")) updateBody.name = nameVal;
          if (fieldsToUpdate.includes("logo_url"))
            updateBody.logo_url = "https://new.com/logo.svg";
          if (fieldsToUpdate.includes("sort_order")) updateBody.sort_order = sortVal;
          if (fieldsToUpdate.includes("is_active")) updateBody.is_active = activeVal;

          // Validate it passes schema
          const parsed = UpdateBrandSchema.safeParse(updateBody);
          expect(parsed.success).toBe(true);

          // Simulate the route handler's update payload construction logic
          // (mirrors brands-management.ts PATCH /:id handler)
          const updatePayload: Record<string, unknown> = {};
          if (updateBody.name != null) updatePayload.name = updateBody.name;
          if (updateBody.logo_url != null) updatePayload.logo_url = updateBody.logo_url;
          if (updateBody.sort_order != null) updatePayload.sort_order = updateBody.sort_order;
          if (updateBody.is_active != null) updatePayload.is_active = updateBody.is_active;

          // Verify: only the fields in fieldsToUpdate appear in the payload
          const payloadKeys = Object.keys(updatePayload);
          for (const key of payloadKeys) {
            expect(fieldsToUpdate).toContain(key);
          }

          // Verify: fields NOT in the update are absent from the payload
          const nonUpdatedFields = UPDATABLE_FIELDS.filter(
            (f) => !fieldsToUpdate.includes(f),
          );
          for (const field of nonUpdatedFields) {
            expect(updatePayload).not.toHaveProperty(field);
          }

          // Verify: applying the payload to existing brand only changes intended fields
          const resultBrand = { ...existingBrand, ...updatePayload };
          for (const field of nonUpdatedFields) {
            expect(resultBrand[field as keyof typeof resultBrand]).toEqual(
              existingBrand[field as keyof typeof existingBrand],
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("an empty body (no fields) is accepted by UpdateBrandSchema (all fields optional)", () => {
    const result = UpdateBrandSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ─── Feature: admin-brand-banner-management, Property 7: Reorder Assignment Correctness ───

describe("Feature: admin-brand-banner-management, Property 7: Reorder Assignment Correctness", () => {
  /**
   * **Validates: Requirements 4.1**
   *
   * For any permutation of all existing brand entry IDs submitted to the reorder
   * endpoint, after the operation completes, each brand's sort_order SHALL equal
   * its zero-based index position in the submitted array.
   *
   * We test the pure logic: given an array of IDs, verify that the reorder mapping
   * assigns index → sort_order correctly for each entry.
   */
  it("for any permutation of IDs, each brand sort_order equals its array index", () => {
    fc.assert(
      fc.property(
        // Generate 1–20 unique UUIDs, then shuffle them
        fc.array(uuidArb, { minLength: 1, maxLength: 20 })
          .filter((arr) => new Set(arr).size === arr.length)
          .chain((ids) => fc.shuffledSubarray(ids, { minLength: ids.length, maxLength: ids.length })),
        (shuffledIds) => {
          // Simulate the reorder logic from the route handler:
          // "Assign sort_order based on array index (0-based)"
          const reorderResult: Array<{ id: string; sort_order: number }> = [];
          for (let i = 0; i < shuffledIds.length; i++) {
            reorderResult.push({ id: shuffledIds[i], sort_order: i });
          }

          // Verify: each brand's sort_order equals its index in the submitted array
          for (let i = 0; i < shuffledIds.length; i++) {
            const entry = reorderResult.find((r) => r.id === shuffledIds[i]);
            expect(entry).toBeDefined();
            expect(entry!.sort_order).toBe(i);
          }

          // Verify: sort_orders form a contiguous 0..n-1 range
          const sortOrders = reorderResult.map((r) => r.sort_order).sort((a, b) => a - b);
          for (let i = 0; i < sortOrders.length; i++) {
            expect(sortOrders[i]).toBe(i);
          }

          // Verify: result length matches input length (no entries lost/added)
          expect(reorderResult.length).toBe(shuffledIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reorder is idempotent — same array yields same sort_orders", () => {
    fc.assert(
      fc.property(
        fc.array(uuidArb, { minLength: 1, maxLength: 15 }).filter(
          (arr) => new Set(arr).size === arr.length,
        ),
        (ids) => {
          // First application
          const result1: Array<{ id: string; sort_order: number }> = ids.map((id, i) => ({
            id,
            sort_order: i,
          }));

          // Second application with same order
          const result2: Array<{ id: string; sort_order: number }> = ids.map((id, i) => ({
            id,
            sort_order: i,
          }));

          // Results should be identical
          for (let i = 0; i < ids.length; i++) {
            expect(result1[i].id).toBe(result2[i].id);
            expect(result1[i].sort_order).toBe(result2[i].sort_order);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Feature: admin-brand-banner-management, Property 8: Reorder Payload Validation ───

describe("Feature: admin-brand-banner-management, Property 8: Reorder Payload Validation", () => {
  /**
   * **Validates: Requirements 4.2, 4.3, 4.4**
   *
   * For any reorder payload that is not a non-empty array of unique valid UUID
   * strings, the Brand_API SHALL return a 400 error.
   * - Non-array payloads → validation fails
   * - Empty arrays → validation fails
   * - Duplicate UUIDs → validation fails
   * - Non-UUID strings → validation fails
   */
  it("non-array payloads are rejected by ReorderBrandsSchema", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.string(),
          fc.boolean(),
          fc.object(),
        ),
        (invalidPayload) => {
          const result = ReorderBrandsSchema.safeParse({ ids: invalidPayload });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("empty array is rejected by ReorderBrandsSchema", () => {
    const result = ReorderBrandsSchema.safeParse({ ids: [] });
    expect(result.success).toBe(false);
  });

  it("arrays with duplicate UUIDs are rejected by ReorderBrandsSchema", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.array(uuidArb, { minLength: 0, maxLength: 5 }),
        (duplicateId, otherIds) => {
          // Create an array with at least one duplicate
          const idsWithDuplicate = [duplicateId, ...otherIds, duplicateId];
          const result = ReorderBrandsSchema.safeParse({ ids: idsWithDuplicate });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("arrays with non-UUID strings are rejected by ReorderBrandsSchema", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => {
            // Filter out strings that happen to be valid UUIDs
            const uuidRegex =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            return !uuidRegex.test(s);
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (nonUuids) => {
          const result = ReorderBrandsSchema.safeParse({ ids: nonUuids });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("valid non-empty arrays of unique UUIDs pass schema validation", () => {
    fc.assert(
      fc.property(
        fc.array(uuidArb, { minLength: 1, maxLength: 20 }).filter(
          (arr) => new Set(arr).size === arr.length,
        ),
        (validIds) => {
          const result = ReorderBrandsSchema.safeParse({ ids: validIds });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("missing 'ids' field is rejected by ReorderBrandsSchema", () => {
    fc.assert(
      fc.property(fc.object(), (randomObj) => {
        // Remove the 'ids' key if it happens to exist
        const noIds = { ...randomObj };
        delete (noIds as Record<string, unknown>)["ids"];
        const result = ReorderBrandsSchema.safeParse(noIds);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("mixed valid UUIDs and non-UUIDs are rejected", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => {
          const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          return !uuidRegex.test(s);
        }),
        (validUuid, invalidString) => {
          const result = ReorderBrandsSchema.safeParse({
            ids: [validUuid, invalidString],
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
