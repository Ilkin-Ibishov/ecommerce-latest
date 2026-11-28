import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { itemsForRole, markUnread, type NeedsYouKey, type RawInboxEvent } from "./inbox";

/**
 * Data-fetching queries for admin inbox counts and events.
 * Implements M4b spec §3–§6 and design note §3–§5.
 */

// get_low_stock_signals is not in the generated Database types (same cast as inventory-signals.ts).
interface LowStockCountClient {
  rpc(
    fn: "get_low_stock_signals",
    args: { p_search: null; p_status: null },
    options: { count: "exact"; head: true }
  ): PromiseLike<{ count: number | null; error: { message: string } | null }>;
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function fetchNeedsYouCounts(
  admin: SupabaseClient<Database>,
  role: string | null | undefined
): Promise<Record<NeedsYouKey, number>> {
  const allowed = new Set(itemsForRole(role));
  const result: Record<NeedsYouKey, number> = {
    counter_needs_owner: 0,
    orders_pending: 0,
    low_stock: 0,
    holds_overdue: 0,
    reviews_pending: 0,
  };

  const tasks: PromiseLike<void>[] = [];

  if (allowed.has("low_stock")) {
    // head + count: data.length would stop at PostgREST's row limit.
    tasks.push(
      (admin as unknown as LowStockCountClient)
        .rpc("get_low_stock_signals", { p_search: null, p_status: null }, { count: "exact", head: true })
        .then(({ count, error }) => {
          check(error);
          result.low_stock = count ?? 0;
        })
    );
  }
  if (allowed.has("holds_overdue")) {
    tasks.push(
      admin.from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .not("expires_at", "is", null)
        .lt("expires_at", new Date().toISOString())
        .then(({ count, error }) => {
          check(error);
          result.holds_overdue = count ?? 0;
        })
    );
  }
  if (allowed.has("counter_needs_owner")) {
    tasks.push(
      admin.from("counter_sales")
        .select("id", { count: "exact", head: true })
        .eq("status", "needs_owner")
        .then(({ count, error }) => {
          check(error);
          result.counter_needs_owner = count ?? 0;
        })
    );
  }
  if (allowed.has("orders_pending")) {
    tasks.push(
      admin.from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .then(({ count, error }) => {
          check(error);
          result.orders_pending = count ?? 0;
        })
    );
  }
  if (allowed.has("reviews_pending")) {
    tasks.push(
      admin.from("comments")
        .select("id", { count: "exact", head: true })
        .eq("approved", false)
        .then(({ count, error }) => {
          check(error);
          result.reviews_pending = count ?? 0;
        })
    );
  }

  await Promise.all(tasks);
  return result;
}

export async function fetchAdminEvents(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<{ events: RawInboxEvent[]; seenAt: string | null }> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [ordersRes, voidsRes, salesRes, stocktakesRes, markerRes] = await Promise.all([
    admin.from("orders").select("id, created_at, customer_name").gte("created_at", fourteenDaysAgo).order("created_at", { ascending: false }).limit(50),
    admin.from("counter_sales").select("id, sale_number, voided_at, voided_by, void_reason").eq("status", "voided").gte("voided_at", fourteenDaysAgo).order("voided_at", { ascending: false }).limit(50),
    // A held sale is not "posted"; lines carry the per-line flags, so one query sees both kinds.
    admin.from("counter_sales").select("id, sale_number, posting_date, cashier_id, total_mismatch, counter_sale_lines(price_mismatch, reservation_override)").neq("status", "needs_owner").gte("posting_date", fourteenDaysAgo).order("posting_date", { ascending: false }),
    admin.from("stocktakes").select("id, stocktake_number, title, posted_at, posted_by").eq("status", "posted").gte("posted_at", fourteenDaysAgo).order("posted_at", { ascending: false }).limit(50),
    admin.from("admin_inbox_seen").select("seen_at").eq("user_id", userId).maybeSingle(),
  ]);

  for (const r of [ordersRes, voidsRes, salesRes, stocktakesRes, markerRes]) check(r.error);

  const flaggedSales = (salesRes.data ?? [])
    .map((m) => {
      const lines = m.counter_sale_lines ?? [];
      return { m, price: lines.some((l) => l.price_mismatch), res: lines.some((l) => l.reservation_override) };
    })
    .filter((x) => x.m.total_mismatch || x.price || x.res)
    .slice(0, 50);

  const rawEvents: RawInboxEvent[] = [];

  for (const o of ordersRes.data ?? []) {
    rawEvents.push({
      id: `order-${o.id}`,
      kind: "order_created",
      time: o.created_at,
      actor_id: null,
      actor_name: null,
      unread: false,
      order_id: typeof o.id === "string" ? o.id.slice(0, 8) : String(o.id),
      customer_name: o.customer_name ?? null,
      link: "/admin/orders",
    });
  }

  for (const v of voidsRes.data ?? []) {
    rawEvents.push({
      id: `void-${v.id}`,
      kind: "counter_sale_voided",
      time: v.voided_at as string, // filtered by status and voided_at
      actor_id: v.voided_by,
      actor_name: null,
      unread: false,
      sale_number: v.sale_number,
      void_reason: v.void_reason ?? null,
      link: "/admin/counter/sales",
    });
  }

  for (const { m, price, res } of flaggedSales) {
    const flagsList: string[] = [];
    if (m.total_mismatch) flagsList.push("total_mismatch");
    if (price) flagsList.push("price_mismatch");
    if (res) flagsList.push("reservation_override");

    rawEvents.push({
      id: `mismatch-${m.id}`,
      kind: "counter_sale_mismatch",
      time: m.posting_date,
      actor_id: m.cashier_id,
      actor_name: null,
      unread: false,
      sale_number: m.sale_number,
      total_mismatch: Boolean(m.total_mismatch),
      price_mismatch: price,
      reservation_override: res,
      mismatch_flags: flagsList,
      link: "/admin/counter/sales",
    });
  }

  for (const st of stocktakesRes.data ?? []) {
    rawEvents.push({
      id: `stocktake-${st.id}`,
      kind: "stocktake_posted",
      time: st.posted_at as string, // filtered by status and posted_at
      actor_id: st.posted_by,
      actor_name: null,
      unread: false,
      stocktake_number: st.stocktake_number,
      title: st.title ?? null,
      link: "/admin/stocktakes",
    });
  }

  const actorIds = Array.from(new Set(rawEvents.map((e) => e.actor_id).filter((id): id is string => Boolean(id))));
  if (actorIds.length > 0) {
    const { data: users, error: usersErr } = await admin.from("users").select("id, full_name").in("id", actorIds);
    check(usersErr);
    const userMap = new Map<string, string | null>((users ?? []).map((u) => [u.id, u.full_name ?? null]));
    for (const event of rawEvents) {
      if (event.actor_id) {
        event.actor_name = userMap.get(event.actor_id) ?? null;
      }
    }
  }

  const seenAt: string | null = markerRes.data?.seen_at ?? null;
  const events = markUnread(rawEvents, seenAt, userId).sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  return { events, seenAt };
}
