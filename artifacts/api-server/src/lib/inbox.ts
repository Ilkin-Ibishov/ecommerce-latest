import { z } from "zod";

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

export const countResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});

export const inboxEventSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "order_created",
    "counter_sale_voided",
    "counter_sale_mismatch",
    "stocktake_posted",
  ]),
  time: z.string(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  unread: z.boolean(),
  order_id: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  sale_number: z.number().int().optional().nullable(),
  void_reason: z.string().optional().nullable(),
  total_mismatch: z.boolean().optional().nullable(),
  price_mismatch: z.boolean().optional().nullable(),
  reservation_override: z.boolean().optional().nullable(),
  mismatch_flags: z.array(z.string()).optional().nullable(),
  stocktake_number: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  link: z.string().optional().nullable(),
});

export const inboxResponseSchema = z.object({
  needs_you: z.array(
    z.object({
      key: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
  events: z.array(inboxEventSchema).nullable(),
  seen_at: z.string().nullable(),
});

export type RawInboxEvent = z.infer<typeof inboxEventSchema>;

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
