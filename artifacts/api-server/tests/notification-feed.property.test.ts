// Feature: super-admin-platform, Property 7: Per-store notification fetch returns only the calling Store's notifications
// Feature: super-admin-platform, Property 8: Notification inbox ordering and item shape
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getStoreFeed, validateMarkRead } from "../src/lib/notifications/feed";
import type {
  NotificationRecord,
  NotificationTarget,
  NotificationRead,
} from "../src/lib/notifications/feed";

/**
 * Property 7: Per-store notification fetch returns only the calling Store's notifications
 * Property 8: Notification inbox ordering and item shape
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8**
 *
 * Property 7:
 * - Feed for storeX contains only notifications targeted at storeX, never any other store's
 * - unread_count = count of items where read=false
 * - markRead on foreign/non-existent → { success: false, httpStatus: 404 }
 *
 * Property 8:
 * - Items are ordered by created_at DESC then id DESC (deterministic tie-break)
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a store ID */
const storeIdArb = fc.uuid();

/** Generate a notification ID */
const notificationIdArb = fc.uuid();

/** Generate a valid ISO datetime string */
const isoDateTimeArb = fc
  .date({ min: new Date("2023-01-01"), max: new Date("2025-12-31"), noInvalidDate: true })
  .map((d) => d.toISOString());

/** Generate a notification record */
const notificationRecordArb = fc.tuple(notificationIdArb, isoDateTimeArb).map(
  ([id, created_at]) =>
    ({
      id,
      content: `Notification content for ${id}`,
      created_at,
    }) as NotificationRecord
);

/** Generate a set of notification records with unique IDs */
const notificationSetArb = (minLength = 0, maxLength = 15) =>
  fc
    .uniqueArray(notificationRecordArb, {
      minLength,
      maxLength,
      selector: (n) => n.id,
    });

/** Generate targeting data: assigns notifications to stores */
function generateTargetsArb(
  notifications: NotificationRecord[],
  storeIds: string[]
) {
  if (notifications.length === 0 || storeIds.length === 0) {
    return fc.constant([] as NotificationTarget[]);
  }
  return fc
    .array(
      fc.tuple(
        fc.integer({ min: 0, max: notifications.length - 1 }),
        fc.integer({ min: 0, max: storeIds.length - 1 })
      ),
      { minLength: 0, maxLength: notifications.length * storeIds.length }
    )
    .map((pairs) => {
      const seen = new Set<string>();
      const targets: NotificationTarget[] = [];
      for (const [ni, si] of pairs) {
        const key = `${notifications[ni].id}:${storeIds[si]}`;
        if (!seen.has(key)) {
          seen.add(key);
          targets.push({
            notification_id: notifications[ni].id,
            store_id: storeIds[si],
          });
        }
      }
      return targets;
    });
}

/** Generate read records for a subset of targets */
function generateReadsArb(targets: NotificationTarget[]) {
  if (targets.length === 0) {
    return fc.constant([] as NotificationRead[]);
  }
  return fc
    .subarray(targets, { minLength: 0, maxLength: targets.length })
    .map((subset) =>
      subset.map((t) => ({
        notification_id: t.notification_id,
        store_id: t.store_id,
      }))
    );
}

// ─── Property 7 Tests ───────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 7: Per-store notification fetch returns only the calling Store's notifications", () => {
  describe("feed isolation: storeX sees only its own notifications", () => {
    it("feed for storeX contains only notifications targeted at storeX", () => {
      fc.assert(
        fc.property(
          fc.tuple(storeIdArb, storeIdArb).filter(([a, b]) => a !== b),
          notificationSetArb(3, 15),
          (storeIds, notifications) => {
            const [storeA, storeB] = storeIds;
            const allStoreIds = [storeA, storeB];

            // Create targets: distribute notifications among stores
            const targets: NotificationTarget[] = [];
            notifications.forEach((n, i) => {
              // Assign to storeA, storeB, or both based on index
              if (i % 3 === 0) {
                targets.push({ notification_id: n.id, store_id: storeA });
              } else if (i % 3 === 1) {
                targets.push({ notification_id: n.id, store_id: storeB });
              } else {
                targets.push({ notification_id: n.id, store_id: storeA });
                targets.push({ notification_id: n.id, store_id: storeB });
              }
            });

            const reads: NotificationRead[] = [];

            // Get feed for storeA
            const feedA = getStoreFeed({
              storeId: storeA,
              notifications,
              targets,
              reads,
            });

            // Get expected notification ids for storeA
            const expectedIdsA = new Set(
              targets
                .filter((t) => t.store_id === storeA)
                .map((t) => t.notification_id)
            );

            // Every item in feedA must be targeted at storeA
            for (const item of feedA.items) {
              expect(expectedIdsA.has(item.id)).toBe(true);
            }

            // No storeB-only notifications should appear in storeA's feed
            const storeBOnlyIds = new Set(
              targets
                .filter((t) => t.store_id === storeB)
                .map((t) => t.notification_id)
                .filter((id) => !expectedIdsA.has(id))
            );
            for (const item of feedA.items) {
              expect(storeBOnlyIds.has(item.id)).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("unread_count = count of items where read=false", () => {
    it("unread_count matches the number of items with read=false", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          notificationSetArb(1, 10),
          fc.nat({ max: 100 }),
          (storeId, notifications, readSeed) => {
            const targets: NotificationTarget[] = notifications.map((n) => ({
              notification_id: n.id,
              store_id: storeId,
            }));

            // Mark some as read based on seed
            const reads: NotificationRead[] = notifications
              .filter((_, i) => (readSeed + i) % 3 === 0)
              .map((n) => ({ notification_id: n.id, store_id: storeId }));

            const feed = getStoreFeed({
              storeId,
              notifications,
              targets,
              reads,
            });

            const actualUnread = feed.items.filter((item) => !item.read).length;
            expect(feed.unread_count).toBe(actualUnread);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("markRead on foreign/non-existent → { success: false, httpStatus: 404 }", () => {
    it("markRead on a non-existent notification returns 404", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          notificationIdArb,
          notificationSetArb(1, 5),
          (storeId, foreignNotifId, notifications) => {
            // Ensure foreignNotifId is not in the notifications
            fc.pre(!notifications.some((n) => n.id === foreignNotifId));

            const targets: NotificationTarget[] = notifications.map((n) => ({
              notification_id: n.id,
              store_id: storeId,
            }));

            const result = validateMarkRead({
              notificationId: foreignNotifId,
              storeId,
              targets,
              notifications,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.httpStatus).toBe(404);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("markRead on a notification not targeted at this store returns 404", () => {
      fc.assert(
        fc.property(
          fc.tuple(storeIdArb, storeIdArb).filter(([a, b]) => a !== b),
          notificationSetArb(1, 5),
          (storeIds, notifications) => {
            const [storeA, storeB] = storeIds;

            // Target all notifications at storeB only
            const targets: NotificationTarget[] = notifications.map((n) => ({
              notification_id: n.id,
              store_id: storeB,
            }));

            // storeA tries to mark-read a notification that's only for storeB
            const result = validateMarkRead({
              notificationId: notifications[0].id,
              storeId: storeA,
              targets,
              notifications,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.httpStatus).toBe(404);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("markRead on a notification targeted at this store returns success", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          notificationSetArb(1, 5),
          (storeId, notifications) => {
            const targets: NotificationTarget[] = notifications.map((n) => ({
              notification_id: n.id,
              store_id: storeId,
            }));

            const result = validateMarkRead({
              notificationId: notifications[0].id,
              storeId,
              targets,
              notifications,
            });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ─── Property 8 Tests ───────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 8: Notification inbox ordering and item shape", () => {
  describe("items are ordered by created_at DESC then id DESC", () => {
    it("feed items maintain created_at DESC ordering", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          notificationSetArb(2, 15),
          (storeId, notifications) => {
            const targets: NotificationTarget[] = notifications.map((n) => ({
              notification_id: n.id,
              store_id: storeId,
            }));

            const feed = getStoreFeed({
              storeId,
              notifications,
              targets,
              reads: [],
            });

            // Check ordering: each item's created_at >= next item's created_at
            for (let i = 0; i < feed.items.length - 1; i++) {
              const curr = feed.items[i];
              const next = feed.items[i + 1];
              const cmp = curr.created_at.localeCompare(next.created_at);
              if (cmp === 0) {
                // Tie-break by id DESC
                expect(curr.id.localeCompare(next.id)).toBeGreaterThanOrEqual(0);
              } else {
                expect(cmp).toBeGreaterThanOrEqual(0);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("notifications with same created_at are tie-broken by id DESC", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          isoDateTimeArb,
          fc.uniqueArray(notificationIdArb, { minLength: 3, maxLength: 10 }),
          (storeId, sharedTimestamp, ids) => {
            // All notifications have the same timestamp
            const notifications: NotificationRecord[] = ids.map((id) => ({
              id,
              content: `Content ${id}`,
              created_at: sharedTimestamp,
            }));

            const targets: NotificationTarget[] = notifications.map((n) => ({
              notification_id: n.id,
              store_id: storeId,
            }));

            const feed = getStoreFeed({
              storeId,
              notifications,
              targets,
              reads: [],
            });

            // All have same created_at, so they should be sorted by id DESC
            for (let i = 0; i < feed.items.length - 1; i++) {
              expect(
                feed.items[i].id.localeCompare(feed.items[i + 1].id)
              ).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("each feed item exposes content, created_at, and read state", () => {
    it("every item has id, content, created_at (string), and read (boolean)", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          notificationSetArb(1, 10),
          (storeId, notifications) => {
            const targets: NotificationTarget[] = notifications.map((n) => ({
              notification_id: n.id,
              store_id: storeId,
            }));

            const feed = getStoreFeed({
              storeId,
              notifications,
              targets,
              reads: [],
            });

            for (const item of feed.items) {
              expect(typeof item.id).toBe("string");
              expect(item.id.length).toBeGreaterThan(0);
              expect(typeof item.content).toBe("string");
              expect(typeof item.created_at).toBe("string");
              expect(typeof item.read).toBe("boolean");
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("empty feed when no notifications targeted at the store", () => {
    it("returns empty items and unread_count=0 when store has no targets", () => {
      fc.assert(
        fc.property(
          fc.tuple(storeIdArb, storeIdArb).filter(([a, b]) => a !== b),
          notificationSetArb(1, 10),
          (storeIds, notifications) => {
            const [storeA, storeB] = storeIds;

            // All notifications targeted at storeB only
            const targets: NotificationTarget[] = notifications.map((n) => ({
              notification_id: n.id,
              store_id: storeB,
            }));

            const feed = getStoreFeed({
              storeId: storeA,
              notifications,
              targets,
              reads: [],
            });

            expect(feed.items).toEqual([]);
            expect(feed.unread_count).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
