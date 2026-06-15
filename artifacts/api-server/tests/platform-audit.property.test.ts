import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  shapeAuditQuery,
  type AuditEntry,
  type AuditQueryParams,
} from "../src/lib/platform/audit-query";

/**
 * Platform Audit Property Tests
 * Feature: super-admin-platform, Property 4: Audit query ordering, cap, and store filter
 *
 * **Validates: Requirements 1.9, 3.6, 5.8, 6.4, 8.4, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 13.10, 14.8, 16.1, 17.1, 17.2, 17.6**
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid UUID v4 */
const uuidArb = fc.uuid();

/** Generate a valid ISO 8601 date string using integer timestamps to avoid invalid date issues */
const isoDateArb = fc
  .integer({
    min: new Date("2020-01-01T00:00:00Z").getTime(),
    max: new Date("2030-12-31T23:59:59Z").getTime(),
  })
  .map((ts) => new Date(ts).toISOString());

/** Generate a platform audit action */
const actionArb = fc.constantFrom(
  "create_store",
  "activate_store",
  "suspend_store",
  "reactivate_store",
  "disable_store",
  "update_subscription_status",
  "send_notification",
  "start_impersonation",
  "end_impersonation",
  "create_plan",
  "archive_plan",
  "generate_invoice",
  "mark_invoice_paid",
  "offboard_store",
  "purge_store",
  "mfa_enroll",
  "sign_in",
  "deny_access"
);

/** Generate a platform audit entity type */
const entityArb = fc.constantFrom(
  "store",
  "subscription_plan",
  "invoice",
  "notification",
  "impersonation_session",
  "platform_admin"
);

/** Generate a single AuditEntry with random fields */
const auditEntryArb: fc.Arbitrary<AuditEntry> = fc.record({
  id: uuidArb,
  actor_id: fc.oneof(uuidArb, fc.constant(null)),
  action: actionArb,
  entity: entityArb,
  entity_id: fc.oneof(uuidArb, fc.constant(null)),
  changes: fc.oneof(
    fc.constant(null),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ maxLength: 20 }))
  ),
  scope: fc.constant("platform"),
  store_id: fc.oneof(uuidArb, fc.constant(null)),
  created_at: isoDateArb,
});

/** Generate an array of AuditEntry objects (0 to 200 entries to test the cap) */
const auditEntriesArb = fc.array(auditEntryArb, { minLength: 0, maxLength: 200 });

/** Generate an invalid UUID (not matching the 8-4-4-4-12 hex pattern) */
const invalidUuidArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }).filter(
    (s) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ),
  fc.constant("not-a-uuid"),
  fc.constant("12345"),
  fc.constant("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz")
);

// ─── Property 4: Audit query ordering, cap, and store filter ────────────────────

describe("Feature: super-admin-platform, Property 4: Audit query ordering, cap, and store filter", () => {
  describe("Ordering: result is ordered by created_at descending (newest first)", () => {
    /**
     * **Validates: Requirements 11.3**
     *
     * For any array of AuditEntry objects, shapeAuditQuery always returns
     * entries sorted by created_at descending.
     */
    it("result entries are always ordered by created_at descending", () => {
      fc.assert(
        fc.property(auditEntriesArb, (entries) => {
          const result = shapeAuditQuery(entries, {});

          if (result.error) return; // skip error cases

          const data = result.data!;
          for (let i = 1; i < data.length; i++) {
            expect(data[i - 1].created_at >= data[i].created_at).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("result entries are ordered by created_at descending even with store_id filter", () => {
      fc.assert(
        fc.property(auditEntriesArb, uuidArb, (entries, storeId) => {
          // Inject the storeId into some entries so we get filtered results
          const modifiedEntries = entries.map((e, i) =>
            i % 2 === 0 ? { ...e, store_id: storeId } : e
          );

          const result = shapeAuditQuery(modifiedEntries, { store_id: storeId });

          if (result.error) return;

          const data = result.data!;
          for (let i = 1; i < data.length; i++) {
            expect(data[i - 1].created_at >= data[i].created_at).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Cap: result has at most 100 entries", () => {
    /**
     * **Validates: Requirements 11.3**
     *
     * Regardless of input size, the result never exceeds 100 entries.
     */
    it("result never exceeds 100 entries regardless of input size", () => {
      fc.assert(
        fc.property(auditEntriesArb, (entries) => {
          const result = shapeAuditQuery(entries, {});

          if (result.error) return;

          expect(result.data!.length).toBeLessThanOrEqual(100);
        }),
        { numRuns: 100 },
      );
    });

    it("when input has more than 100 entries, result is capped at exactly 100", () => {
      fc.assert(
        fc.property(
          fc.array(auditEntryArb, { minLength: 101, maxLength: 200 }),
          (entries) => {
            const result = shapeAuditQuery(entries, {});

            if (result.error) return;

            expect(result.data!.length).toBe(100);
          }
        ),
        { numRuns: 100 },
      );
    });

    it("cap is applied AFTER filtering by store_id", () => {
      fc.assert(
        fc.property(
          uuidArb,
          fc.array(auditEntryArb, { minLength: 101, maxLength: 200 }),
          (storeId, entries) => {
            // Give all entries the same store_id to ensure >100 entries pass the filter
            const modifiedEntries = entries.map((e) => ({ ...e, store_id: storeId }));

            const result = shapeAuditQuery(modifiedEntries, { store_id: storeId });

            if (result.error) return;

            expect(result.data!.length).toBe(100);
          }
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Store filter with valid UUID: all returned entries have that store_id", () => {
    /**
     * **Validates: Requirements 11.4**
     *
     * When filtered by a valid UUID store_id, every returned entry has that store_id.
     */
    it("when store_id filter is a valid UUID, all returned entries match it", () => {
      fc.assert(
        fc.property(auditEntriesArb, uuidArb, (entries, storeId) => {
          // Inject storeId into some entries so we get non-trivial results
          const modifiedEntries = entries.map((e, i) =>
            i % 3 === 0 ? { ...e, store_id: storeId } : e
          );

          const result = shapeAuditQuery(modifiedEntries, { store_id: storeId });

          if (result.error) return;

          for (const entry of result.data!) {
            expect(entry.store_id!.toLowerCase()).toBe(storeId.toLowerCase());
          }
        }),
        { numRuns: 100 },
      );
    });

    it("filtering is case-insensitive for store_id UUIDs", () => {
      fc.assert(
        fc.property(auditEntriesArb, uuidArb, (entries, storeId) => {
          const modifiedEntries = entries.map((e, i) =>
            i % 2 === 0 ? { ...e, store_id: storeId.toUpperCase() } : e
          );

          const result = shapeAuditQuery(modifiedEntries, {
            store_id: storeId.toLowerCase(),
          });

          if (result.error) return;

          // All returned entries should match (case-insensitive)
          for (const entry of result.data!) {
            expect(entry.store_id!.toLowerCase()).toBe(storeId.toLowerCase());
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Empty result: when no entries match, result is an empty array", () => {
    /**
     * **Validates: Requirements 11.4**
     *
     * When filtering by a store_id that no entry has, the result is an empty array.
     */
    it("when no entries match the store_id filter, result is empty array", () => {
      fc.assert(
        fc.property(auditEntriesArb, uuidArb, uuidArb, (entries, storeId, filterStoreId) => {
          // Only proceed if the filter store_id is different from any entry's store_id
          fc.pre(storeId !== filterStoreId);

          // Set all entries to have one store_id
          const modifiedEntries = entries.map((e) => ({ ...e, store_id: storeId }));

          const result = shapeAuditQuery(modifiedEntries, { store_id: filterStoreId });

          if (result.error) return;

          expect(result.data!).toEqual([]);
        }),
        { numRuns: 100 },
      );
    });

    it("when entries array is empty, result is empty array regardless of params", () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant(undefined), uuidArb),
          (storeId) => {
            const params: AuditQueryParams = storeId ? { store_id: storeId } : {};
            const result = shapeAuditQuery([], params);

            if (result.error) return;

            expect(result.data!).toEqual([]);
          }
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Invalid store_id filter: returns error indicator", () => {
    /**
     * **Validates: Requirements 11.5**
     *
     * When store_id filter is provided but is NOT a valid UUID, returns
     * { error: 'invalid_store_filter' } instead of data.
     */
    it("when store_id is not a valid UUID, returns { error: 'invalid_store_filter' }", () => {
      fc.assert(
        fc.property(auditEntriesArb, invalidUuidArb, (entries, badStoreId) => {
          const result = shapeAuditQuery(entries, { store_id: badStoreId });

          expect(result.error).toBe("invalid_store_filter");
          expect(result.data).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Absent store_id: all entries are returned (up to cap)", () => {
    /**
     * **Validates: Requirements 11.4**
     *
     * When no store_id filter is provided, all entries are returned (subject to
     * the 100-entry cap and descending ordering).
     */
    it("when store_id is absent, all entries are returned up to 100", () => {
      fc.assert(
        fc.property(auditEntriesArb, (entries) => {
          const result = shapeAuditQuery(entries, {});

          if (result.error) return;

          const expectedCount = Math.min(entries.length, 100);
          expect(result.data!.length).toBe(expectedCount);
        }),
        { numRuns: 100 },
      );
    });

    it("when store_id is undefined, result contains the same entries as input (up to cap, reordered)", () => {
      fc.assert(
        fc.property(
          fc.array(auditEntryArb, { minLength: 0, maxLength: 100 }),
          (entries) => {
            const result = shapeAuditQuery(entries, {});

            if (result.error) return;

            // All input entries should appear in the result (since count <= 100)
            const resultIds = new Set(result.data!.map((e) => e.id));
            for (const entry of entries) {
              expect(resultIds.has(entry.id)).toBe(true);
            }
          }
        ),
        { numRuns: 100 },
      );
    });

    it("when store_id is empty string, it is treated as absent (no filter applied)", () => {
      fc.assert(
        fc.property(
          fc.array(auditEntryArb, { minLength: 0, maxLength: 100 }),
          (entries) => {
            const result = shapeAuditQuery(entries, { store_id: "" });

            if (result.error) return;

            // Should not filter — return all entries
            expect(result.data!.length).toBe(entries.length);
          }
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Composition: ordering + cap + filter work together correctly", () => {
    /**
     * **Validates: Requirements 11.3, 11.4, 11.5**
     *
     * When all constraints are combined, the result satisfies all properties
     * simultaneously.
     */
    it("filtered + capped results are still ordered descending", () => {
      fc.assert(
        fc.property(
          uuidArb,
          fc.array(auditEntryArb, { minLength: 101, maxLength: 200 }),
          (storeId, entries) => {
            // Give all entries the target store_id
            const modifiedEntries = entries.map((e) => ({ ...e, store_id: storeId }));

            const result = shapeAuditQuery(modifiedEntries, { store_id: storeId });

            if (result.error) return;

            // Capped
            expect(result.data!.length).toBe(100);

            // Ordered descending
            for (let i = 1; i < result.data!.length; i++) {
              expect(result.data![i - 1].created_at >= result.data![i].created_at).toBe(true);
            }

            // All match store_id
            for (const entry of result.data!) {
              expect(entry.store_id!.toLowerCase()).toBe(storeId.toLowerCase());
            }
          }
        ),
        { numRuns: 100 },
      );
    });

    it("the 100 entries returned are the 100 newest by created_at", () => {
      fc.assert(
        fc.property(
          fc.array(auditEntryArb, { minLength: 101, maxLength: 200 }),
          (entries) => {
            const result = shapeAuditQuery(entries, {});

            if (result.error) return;

            // Sort input by created_at desc to determine expected top 100
            const sorted = [...entries].sort((a, b) => {
              if (b.created_at > a.created_at) return 1;
              if (b.created_at < a.created_at) return -1;
              return 0;
            });
            const expected100 = sorted.slice(0, 100);

            // The result should contain exactly the same entries as expected
            // (order may differ only by stable sort tie-breaking, but values match)
            expect(result.data!.length).toBe(100);

            const resultCreatedAts = result.data!.map((e) => e.created_at);
            const expectedCreatedAts = expected100.map((e) => e.created_at);
            expect(resultCreatedAts).toEqual(expectedCreatedAts);
          }
        ),
        { numRuns: 100 },
      );
    });
  });
});
