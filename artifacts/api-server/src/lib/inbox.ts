/**
 * Inbox pure logic: role-based needs_you items and event unread calculation.
 *
 * Implements M4b spec §4, §6 and design note §3–§5.
 */

export const ADMIN_NEEDS_YOU_KEYS = [
  "counter_needs_owner",
  "orders_pending",
  "low_stock",
  "holds_overdue",
  "reviews_pending",
] as const;

export const STAFF_NEEDS_YOU_KEYS = [
  "low_stock",
  "holds_overdue",
] as const;

export type NeedsYouKey =
  | (typeof ADMIN_NEEDS_YOU_KEYS)[number]
  | (typeof STAFF_NEEDS_YOU_KEYS)[number];

/**
 * Returns the list of 'needs you' item keys accessible to the given user role.
 * Staff members can only view low_stock and holds_overdue.
 * Administrators view all 5 items. Other roles receive an empty list.
 */
export function itemsForRole(role: string | null | undefined): NeedsYouKey[] {
  if (role === "admin") {
    return [...ADMIN_NEEDS_YOU_KEYS];
  }
  if (role === "staff") {
    return [...STAFF_NEEDS_YOU_KEYS];
  }
  return [];
}

export interface BaseInboxEvent {
  time: string | Date;
  actor_id?: string | null;
  actorId?: string | null;
  [key: string]: unknown;
}

/**
 * Annotates each event with an `unread` boolean flag.
 *
 * An event is unread when:
 * 1. `time > marker` (where no marker defaults to `now - 14 days`); and
 * 2. The actor is NOT the current session user (NULL actor counts as someone else).
 */
export function markUnread<T extends BaseInboxEvent>(
  events: T[],
  marker: string | Date | null | undefined,
  userId: string,
  now: Date = new Date()
): (T & { unread: boolean })[] {
  const cutoffMs = marker
    ? new Date(marker).getTime()
    : now.getTime() - 14 * 24 * 60 * 60 * 1000;

  return events.map((event) => {
    const eventTimeMs = new Date(event.time).getTime();
    const actor = event.actor_id !== undefined ? event.actor_id : event.actorId ?? null;
    const isOwnAction = actor !== null && actor !== undefined && actor === userId;
    const isNewer = eventTimeMs > cutoffMs;
    const unread = isNewer && !isOwnAction;

    return {
      ...event,
      unread,
    };
  });
}
