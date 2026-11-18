import { itemsForRole, markUnread, type NeedsYouKey, type RawInboxEvent } from "./inbox";

/**
 * Data-fetching queries for admin inbox counts and events.
 * Implements M4b spec §3–§6 and design note §3–§5.
 */

export async function fetchNeedsYouCounts(
  admin: any,
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

  const tasks: Promise<void>[] = [];

  if (allowed.has("low_stock")) {
    tasks.push(
      admin.rpc("get_low_stock_signals", { p_search: null, p_status: null }).then(({ data }: any) => {
        result.low_stock = Array.isArray(data) ? data.length : 0;
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
        .then(({ count }: any) => {
          result.holds_overdue = count ?? 0;
        })
    );
  }
  if (allowed.has("counter_needs_owner")) {
    tasks.push(
      admin.from("counter_sales")
        .select("id", { count: "exact", head: true })
        .eq("status", "needs_owner")
        .then(({ count }: any) => {
          result.counter_needs_owner = count ?? 0;
        })
    );
  }
  if (allowed.has("orders_pending")) {
    tasks.push(
      admin.from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .then(({ count }: any) => {
          result.orders_pending = count ?? 0;
        })
    );
  }
  if (allowed.has("reviews_pending")) {
    tasks.push(
      admin.from("comments")
        .select("id", { count: "exact", head: true })
        .eq("approved", false)
        .then(({ count }: any) => {
          result.reviews_pending = count ?? 0;
        })
    );
  }

  await Promise.all(tasks);
  return result;
}

export async function fetchAdminEvents(
  admin: any,
  userId: string
): Promise<{ events: RawInboxEvent[]; seenAt: string | null }> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [ordersRes, voidsRes, linesRes, stocktakesRes, markerRes] = await Promise.all([
    admin.from("orders").select("id, created_at, customer_name").gte("created_at", fourteenDaysAgo).order("created_at", { ascending: false }).limit(50),
    admin.from("counter_sales").select("id, sale_number, voided_at, voided_by, void_reason").eq("status", "voided").gte("voided_at", fourteenDaysAgo).order("voided_at", { ascending: false }).limit(50),
    admin.from("counter_sale_lines").select("sale_id, price_mismatch, reservation_override").or("price_mismatch.eq.true,reservation_override.eq.true").limit(200),
    admin.from("stocktakes").select("id, stocktake_number, title, posted_at, posted_by").eq("status", "posted").gte("posted_at", fourteenDaysAgo).order("posted_at", { ascending: false }).limit(50),
    admin.from("admin_inbox_seen").select("seen_at").eq("user_id", userId).maybeSingle(),
  ]);

  const lineFlags = new Map<string, { price: boolean; res: boolean }>();
  for (const l of linesRes.data ?? []) {
    const prev = lineFlags.get(l.sale_id) ?? { price: false, res: false };
    if (l.price_mismatch) prev.price = true;
    if (l.reservation_override) prev.res = true;
    lineFlags.set(l.sale_id, prev);
  }

  const lineSaleIds = Array.from(lineFlags.keys());
  let mismatchQuery = admin.from("counter_sales")
    .select("id, sale_number, posting_date, cashier_id, total_mismatch")
    .gte("posting_date", fourteenDaysAgo);

  if (lineSaleIds.length > 0) {
    mismatchQuery = mismatchQuery.or(`total_mismatch.eq.true,id.in.(${lineSaleIds.join(",")})`);
  } else {
    mismatchQuery = mismatchQuery.eq("total_mismatch", true);
  }
  const { data: mismatchSales } = await mismatchQuery.order("posting_date", { ascending: false }).limit(50);

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
      time: v.voided_at,
      actor_id: v.voided_by,
      actor_name: null,
      unread: false,
      sale_number: v.sale_number,
      void_reason: v.void_reason ?? null,
      link: "/admin/counter/sales",
    });
  }

  for (const m of mismatchSales ?? []) {
    const flags = lineFlags.get(m.id);
    const flagsList: string[] = [];
    if (m.total_mismatch) flagsList.push("total_mismatch");
    if (flags?.price) flagsList.push("price_mismatch");
    if (flags?.res) flagsList.push("reservation_override");

    rawEvents.push({
      id: `mismatch-${m.id}`,
      kind: "counter_sale_mismatch",
      time: m.posting_date,
      actor_id: m.cashier_id,
      actor_name: null,
      unread: false,
      sale_number: m.sale_number,
      total_mismatch: Boolean(m.total_mismatch),
      price_mismatch: Boolean(flags?.price),
      reservation_override: Boolean(flags?.res),
      mismatch_flags: flagsList,
      link: "/admin/counter/sales",
    });
  }

  for (const st of stocktakesRes.data ?? []) {
    rawEvents.push({
      id: `stocktake-${st.id}`,
      kind: "stocktake_posted",
      time: st.posted_at,
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
    const { data: users } = await admin.from("users").select("id, full_name").in("id", actorIds);
    const userMap = new Map<string, string | null>((users ?? []).map((u: any) => [u.id, u.full_name ?? null]));
    for (const event of rawEvents) {
      if (event.actor_id) {
        event.actor_name = userMap.get(event.actor_id) ?? null;
      }
    }
  }

  const seenAt: string | null = (markerRes.data as any)?.seen_at ?? null;
  const events = markUnread(rawEvents, seenAt, userId).sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  return { events, seenAt };
}
