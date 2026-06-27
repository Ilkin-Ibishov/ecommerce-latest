import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  getStoreFeed,
  validateMarkRead,
  type NotificationRecord,
  type NotificationTarget,
  type NotificationRead,
} from "../src/lib/notifications/feed";

/**
 * Per-Store Notification Feed Property Tests
 *
 * Feature: super-admin-platform
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8
 *
 * Exercises the pure feed-isolation/ordering logic in
 * `src/lib/notifications/feed.ts`:
 *  - Property 7: a per-store fetch returns exactly that Store's targeted
 *    notifications, excludes every other Store's, and reports a correct
 *    unread count >= 0.
 *  - Property 8: feed items are ordered created_at desc then id desc, each
 *    item exposes content/created_at/read-state, and mark-read on a
 *    non-existent or foreign notification yields 404 with read state
 *    unchanged.
 */

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A small pool of timestamps so that many notifications share the same
 * `created_at`, forcing the deterministic id-based tie-break to be exercised.
 */
const createdAtArb = fc
  .integer({ min: 0, max: 8 })
  .map((dayOffset) =>
    new Date(Date.UTC(2023, 0, 1 + dayOffset)).toISOString(),
  );

const notificationArb = fc.record({
  id: fc.uuid(),
  content: fc.string({ minLength: 0, maxLength: 200 }),
  created_at: createdAtArb,
});

/**
 * Builds a complete scenario: a set of stores, a set of notifications, the
 * per-notification target subsets (single/several/broadcast all emerge
 * naturally from subarray selection), and a read flag per target.
 */
const scenarioArb = fc
  .record({
    stores: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 5 }),
    notifs: fc.uniqueArray(notificationArb, {
      selector: (n) => n.id,
      minLength: 0,
      maxLength: 12,
    }),
  })
  .chain(({ stores, notifs }) => {
    // For each notification, pick which stores it is targeted at.
    const targetSubsetsArb = fc.tuple(
      ...notifs.map(() => fc.subarray(stores, { minLength: 0 })),
    );
    return fc.record({
      stores: fc.constant(stores),
      notifs: fc.constant(notifs),
      targetSubsets: targetSubsetsArb,
    });
  })
  .chain(({ stores, notifs, targetSubsets }) => {
    const targets: NotificationTarget[] = [];
    notifs.forEach((n, i) => {
      for (const storeId of targetSubsets[i]) {
        targets.push({ notification_id: n.id, store_id: storeId });
      }
    });
    // For each target, decide whether that store has read that notification.
    const readFlagsArb = fc.tuple(...targets.map(() => fc.boolean()));
    return fc.record({
      stores: fc.constant(stores),
      notifs: fc.constant(notifs),
      targets: fc.constant(targets),
      readFlags: readFlagsArb,
    });
  })
  .map(({ stores, notifs, targets, readFlags }) => {
    const reads: NotificationRead[] = [];
    targets.forEach((t, i) => {
      if (readFlags[i]) {
        reads.push({ notification_id: t.notification_id, store_id: t.store_id });
      }
    });
    return { stores, notifs, targets, reads };
  });

/** Deterministic reference comparator: created_at desc, then id desc. */
function descComparator(
  a: { created_at: string; id: string },
  b: { created_at: string; id: string },
): number {
  const dateCompare = b.created_at.localeCompare(a.created_at);
  if (dateCompare !== 0) return dateCompare;
  return b.id.localeCompare(a.id);
}

// ─── Property 7: Per-store fetch returns only the calling Store's notifications ─
// Feature: super-admin-platform, Property 7: Per-store notification fetch returns only the calling Store's notifications

describe("Feature: super-admin-platform, Property 7: Per-store notification fetch returns only the calling Store's notifications", () => {
  /**
   * **Validates: Requirements 7.1, 7.5, 7.6**
   *
   * For every store in a scenario with overlapping/broadcast targeting, the
   * feed contains exactly that store's targeted notifications, excludes every
   * other store's, and reports a correct unread count >= 0.
   */
  it("returns exactly the resolved store's targeted notifications and excludes all others", () => {
    fc.assert(
      fc.property(scenarioArb, ({ stores, notifs, targets, reads }) => {
        const notifById = new Map(notifs.map((n) => [n.id, n]));

        for (const storeId of stores) {
          const result = getStoreFeed({ storeId, notifications: notifs, targets, reads });

          // Reference set of notification ids targeted at THIS store.
          const expectedIds = new Set(
            targets
              .filter((t) => t.store_id === storeId)
              .map((t) => t.notification_id)
              // Only count targets whose notification actually exists.
              .filter((id) => notifById.has(id)),
          );

          const actualIds = new Set(result.items.map((i) => i.id));

          // Exact match: every expected id present, no foreign id leaks in.
          expect(actualIds).toEqual(expectedIds);

          // No item may belong to a notification not targeted at this store.
          const readSet = new Set(
            reads
              .filter((r) => r.store_id === storeId)
              .map((r) => r.notification_id),
          );
          for (const item of result.items) {
            const target = targets.find(
              (t) => t.notification_id === item.id && t.store_id === storeId,
            );
            expect(target).toBeDefined();

            // Content/created_at faithfully reflect the source notification.
            const src = notifById.get(item.id)!;
            expect(item.content).toBe(src.content);
            expect(item.created_at).toBe(src.created_at);
            expect(item.read).toBe(readSet.has(item.id));
          }

          // Unread count is correct and >= 0.
          const expectedUnread = result.items.filter((i) => !i.read).length;
          expect(result.unread_count).toBe(expectedUnread);
          expect(result.unread_count).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.6**
   *
   * A store with no targeted notifications gets an empty list and unread 0.
   */
  it("returns an empty list and unread count 0 for a store with no targeted notifications", () => {
    fc.assert(
      fc.property(scenarioArb, fc.uuid(), ({ notifs, targets, reads, stores }, outsiderId) => {
        // Use a store id that is guaranteed not to be in the target set.
        fc.pre(!stores.includes(outsiderId));
        fc.pre(!targets.some((t) => t.store_id === outsiderId));

        const result = getStoreFeed({
          storeId: outsiderId,
          notifications: notifs,
          targets,
          reads,
        });

        expect(result.items).toEqual([]);
        expect(result.unread_count).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8: Notification inbox ordering and item shape ────────────────────
// Feature: super-admin-platform, Property 8: Notification inbox ordering and item shape

describe("Feature: super-admin-platform, Property 8: Notification inbox ordering and item shape", () => {
  /**
   * **Validates: Requirements 7.2, 7.8**
   *
   * Feed items are ordered created_at desc then id desc, and each item
   * exposes content, created_at, and read state.
   */
  it("orders items by created_at desc then id desc and exposes content/created_at/read-state", () => {
    fc.assert(
      fc.property(scenarioArb, ({ stores, notifs, targets, reads }) => {
        for (const storeId of stores) {
          const result = getStoreFeed({ storeId, notifications: notifs, targets, reads });

          // Ordering: every adjacent pair respects created_at desc, id desc.
          for (let i = 0; i + 1 < result.items.length; i++) {
            expect(descComparator(result.items[i], result.items[i + 1])).toBeLessThanOrEqual(0);
          }

          // Equivalent check: items match a reference-sorted copy.
          const sorted = [...result.items].sort(descComparator);
          expect(result.items).toEqual(sorted);

          // Item shape: each item exposes the documented fields with the
          // correct types.
          for (const item of result.items) {
            expect(typeof item.id).toBe("string");
            expect(typeof item.content).toBe("string");
            expect(typeof item.created_at).toBe("string");
            expect(typeof item.read).toBe("boolean");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.3, 7.4**
   *
   * Marking a non-existent notification as read yields 404 and leaves the
   * computed read state unchanged.
   */
  it("returns 404 for a non-existent notification id and leaves read state unchanged", () => {
    fc.assert(
      fc.property(scenarioArb, fc.uuid(), ({ stores, notifs, targets, reads }, missingId) => {
        // Ensure the id truly does not exist among the notifications.
        fc.pre(!notifs.some((n) => n.id === missingId));

        const storeId = stores[0];
        const before = getStoreFeed({ storeId, notifications: notifs, targets, reads });
        const readsSnapshot = JSON.stringify(reads);

        const result = validateMarkRead({
          notificationId: missingId,
          storeId,
          targets,
          notifications: notifs,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.httpStatus).toBe(404);
          expect(typeof result.error).toBe("string");
        }

        // Read state unchanged: inputs not mutated, feed identical.
        expect(JSON.stringify(reads)).toBe(readsSnapshot);
        const after = getStoreFeed({ storeId, notifications: notifs, targets, reads });
        expect(after).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * Marking a notification that exists but is targeted at a different store
   * (foreign) yields 404 and leaves the computed read state unchanged.
   */
  it("returns 404 for a foreign notification id and leaves read state unchanged", () => {
    // A notification targeted only at storeA, queried by storeB.
    const foreignScenarioArb = fc
      .record({
        storeA: fc.uuid(),
        storeB: fc.uuid(),
        notif: notificationArb,
        // Optional reads for storeA so we can confirm they survive a 404.
        storeARead: fc.boolean(),
      })
      .filter(({ storeA, storeB }) => storeA !== storeB);

    fc.assert(
      fc.property(foreignScenarioArb, ({ storeA, storeB, notif, storeARead }) => {
        const notifications: NotificationRecord[] = [notif];
        const targets: NotificationTarget[] = [
          { notification_id: notif.id, store_id: storeA },
        ];
        const reads: NotificationRead[] = storeARead
          ? [{ notification_id: notif.id, store_id: storeA }]
          : [];

        const beforeA = getStoreFeed({ storeId: storeA, notifications, targets, reads });
        const readsSnapshot = JSON.stringify(reads);

        const result = validateMarkRead({
          notificationId: notif.id,
          storeId: storeB,
          targets,
          notifications,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.httpStatus).toBe(404);
          expect(typeof result.error).toBe("string");
        }

        // Read state for the legitimate store (A) is unchanged.
        expect(JSON.stringify(reads)).toBe(readsSnapshot);
        const afterA = getStoreFeed({ storeId: storeA, notifications, targets, reads });
        expect(afterA).toEqual(beforeA);
      }),
      { numRuns: 100 },
    );
  });
});
