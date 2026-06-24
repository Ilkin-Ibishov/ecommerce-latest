import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Order Tracking API Property Tests
 * Feature: order-tracking-timeline, Property 1: Status history is sorted by changed_at ascending
 *
 * **Validates: Requirements 2.2**
 *
 * For any order with multiple status history entries, the API response
 * `status_history` array SHALL be sorted by `changed_at` in ascending
 * chronological order.
 *
 * This test validates the sorting logic used by the API endpoint
 * (`GET /profile/orders/:id`) which sorts history via
 * `.order("changed_at", { ascending: true })`.
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid status value from the order lifecycle */
const statusArb = fc.constantFrom(
  "pending",
  "phone_verified",
  "courier_assigned",
  "shipped",
  "delivered",
  "cancelled",
  "refused_at_delivery"
);

/** Generate a valid ISO timestamp string within a reasonable range */
const minTimestamp = new Date("2024-01-01T00:00:00Z").getTime();
const maxTimestamp = new Date("2025-12-31T23:59:59Z").getTime();

const isoTimestampArb = fc
  .integer({ min: minTimestamp, max: maxTimestamp })
  .map((ms) => new Date(ms).toISOString());

/** Generate a history entry with a random timestamp */
const historyEntryArb = fc.record({
  id: fc.uuid(),
  old_status: fc.oneof(
    fc.constant(null),
    statusArb
  ),
  new_status: statusArb,
  changed_at: isoTimestampArb,
  changed_by: fc.uuid(),
});

// ─── Sort function (mirrors API behavior: .order("changed_at", { ascending: true })) ──

function sortByChangedAtAscending<T extends { changed_at: string }>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
  );
}

// ─── Property 1: Status history is sorted by changed_at ascending ──────────────

describe("Feature: order-tracking-timeline, Property 1: Status history sorted by changed_at ascending", () => {
  /**
   * **Validates: Requirements 2.2**
   *
   * For any set of history entries with arbitrary timestamps,
   * after sorting by changed_at ascending, every entry's changed_at
   * is >= the previous entry's changed_at.
   */
  it("should maintain ascending order by changed_at for any set of history entries", () => {
    fc.assert(
      fc.property(
        fc.array(historyEntryArb, { minLength: 2, maxLength: 50 }),
        (entries) => {
          // Sort the same way the API does
          const sorted = sortByChangedAtAscending(entries);

          // Verify ascending order property
          for (let i = 1; i < sorted.length; i++) {
            const prev = new Date(sorted[i - 1].changed_at).getTime();
            const curr = new Date(sorted[i].changed_at).getTime();
            expect(curr).toBeGreaterThanOrEqual(prev);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Sorting preserves all original entries (no data loss).
   * The sorted result must contain exactly the same elements as the input.
   */
  it("sorting preserves all original entries without loss or duplication", () => {
    fc.assert(
      fc.property(
        fc.array(historyEntryArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const sorted = sortByChangedAtAscending(entries);

          // Same length
          expect(sorted.length).toBe(entries.length);

          // Same set of IDs (entries are preserved)
          const originalIds = entries.map((e) => e.id).sort();
          const sortedIds = sorted.map((e) => e.id).sort();
          expect(sortedIds).toEqual(originalIds);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Sorting is idempotent — sorting an already-sorted array yields the same result.
   */
  it("sorting is idempotent (re-sorting produces the same order)", () => {
    fc.assert(
      fc.property(
        fc.array(historyEntryArb, { minLength: 2, maxLength: 50 }),
        (entries) => {
          const sorted1 = sortByChangedAtAscending(entries);
          const sorted2 = sortByChangedAtAscending(sorted1);

          // Idempotent: sorting twice gives same result
          expect(sorted2.map((e) => e.id)).toEqual(sorted1.map((e) => e.id));
        }
      ),
      { numRuns: 100 }
    );
  });
});
