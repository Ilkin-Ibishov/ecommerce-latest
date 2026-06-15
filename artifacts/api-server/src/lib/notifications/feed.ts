/**
 * Per-store notification feed — pure functions for isolation, ordering, and mark-read.
 *
 * Feature: super-admin-platform
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationRecord {
  id: string;
  content: string;
  created_at: string; // ISO 8601
}

export interface NotificationTarget {
  notification_id: string;
  store_id: string;
}

export interface NotificationRead {
  notification_id: string;
  store_id: string;
}

export interface FeedItem {
  id: string;
  content: string;
  created_at: string;
  read: boolean;
}

export interface FeedResult {
  items: FeedItem[];
  unread_count: number;
}

// ---------------------------------------------------------------------------
// getStoreFeed — returns exactly the calling Store's notifications
// ---------------------------------------------------------------------------

/**
 * Given a resolved store id, all notifications, all targets, and all reads,
 * return exactly the notifications targeted at this store with correct
 * read state, ordered by created_at DESC then id DESC (deterministic tie-break).
 *
 * - Excludes all notifications not targeted at this store (R7.1)
 * - Each item exposes content, created_at, and read state (R7.2)
 * - unread_count >= 0 = count of targeted notifications with no read (R7.5)
 * - Empty when no notifications targeted at this store (R7.6)
 * - Order: created_at desc, id desc (R7.8)
 */
export function getStoreFeed(input: {
  storeId: string;
  notifications: NotificationRecord[];
  targets: NotificationTarget[];
  reads: NotificationRead[];
}): FeedResult {
  const { storeId, notifications, targets, reads } = input;

  // 1. Filter targets to only those where store_id === storeId
  const storeTargetNotificationIds = new Set(
    targets
      .filter((t) => t.store_id === storeId)
      .map((t) => t.notification_id),
  );

  // 2. Filter notifications to only those in the store's target set
  const storeNotifications = notifications.filter((n) =>
    storeTargetNotificationIds.has(n.id),
  );

  // 3. Build a set of read notification ids for this store
  const readNotificationIds = new Set(
    reads
      .filter((r) => r.store_id === storeId)
      .map((r) => r.notification_id),
  );

  // 4. Map to FeedItems with read state
  const items: FeedItem[] = storeNotifications.map((n) => ({
    id: n.id,
    content: n.content,
    created_at: n.created_at,
    read: readNotificationIds.has(n.id),
  }));

  // 5. Order by created_at DESC, then by id DESC (deterministic tie-break)
  items.sort((a, b) => {
    const dateCompare = b.created_at.localeCompare(a.created_at);
    if (dateCompare !== 0) return dateCompare;
    return b.id.localeCompare(a.id);
  });

  // 6. Count unread
  const unread_count = items.filter((item) => !item.read).length;

  return { items, unread_count };
}

// ---------------------------------------------------------------------------
// validateMarkRead — validates that a mark-read request is legal
// ---------------------------------------------------------------------------

export type MarkReadResult =
  | { success: true }
  | { success: false; httpStatus: 404; error: string };

/**
 * Validates a mark-read request:
 * - If notificationId does not exist → 404 "Notification not found"
 * - If notification exists but is not targeted at storeId → 404 "Notification not found" (foreign)
 * - Both exist → success (read state can be set)
 *
 * On failure, read state remains unchanged (R7.4).
 */
export function validateMarkRead(input: {
  notificationId: string;
  storeId: string;
  targets: NotificationTarget[];
  notifications: NotificationRecord[];
}): MarkReadResult {
  const { notificationId, storeId, targets, notifications } = input;

  // 1. Check that notificationId exists in notifications
  const notificationExists = notifications.some((n) => n.id === notificationId);
  if (!notificationExists) {
    return { success: false, httpStatus: 404, error: 'Notification not found' };
  }

  // 2. Check that there's a target entry for (notificationId, storeId)
  const isTargeted = targets.some(
    (t) => t.notification_id === notificationId && t.store_id === storeId,
  );
  if (!isTargeted) {
    return { success: false, httpStatus: 404, error: 'Notification not found' };
  }

  // 3. Both exist → success
  return { success: true };
}
