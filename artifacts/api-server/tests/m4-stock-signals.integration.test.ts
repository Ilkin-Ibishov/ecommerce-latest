import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/** Phase M4 Stock Signals integration suite against live ledger & Express routes. */
const BASE = `http://localhost:${process.env.PORT || "5000"}/api`;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let session: AuthSession;
let actorId: string;

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const setRole = (role: string) => (db as any).from("users").update({ role }).eq("id", session.userId);

const sale = (lines: { variant_id: string; quantity: number; price: number }[], id = randomUUID()) => {
  const priced = lines.map((l, i) => ({
    line_no: i + 1, variant_id: l.variant_id, quantity: l.quantity,
    charged_unit_price: l.price, bundle_id: null, net_line_total: Math.round(l.quantity * l.price * 100) / 100,
  }));
  const total = Math.round(priced.reduce((s, l) => s + l.net_line_total * 100, 0)) / 100;
  return { id, sold_at: new Date().toISOString(), payment_method: "cash", note: null, displayed_total: total, bundle_discount: 0, owner_discount: 0, total_amount: total, lines: priced };
};

const postSale = (s: ReturnType<typeof sale>, hash = "h-" + s.id) =>
  (db as any).rpc("post_counter_sale", { p_sale: s, p_payload_hash: hash, p_session_user: actorId });

async function createVariant(client: SupabaseClient, opts: { track?: boolean; daysAgo?: number; onHand?: number; actor?: string } = {}): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: p } = await (client as any).from("products").insert({ slug: `f-${stamp}`, price: 10, stock: 0, sort_order: 1_000_000 }).select("id").single();
  await (client as any).from("product_translations").insert({ product_id: p.id, lang_code: "az", title: `T ${stamp}` });
  const { data: v } = await (client as any).from("product_variants").insert({ product_id: p.id, sku: `F-${stamp}`, price: 10, on_hand: 0, track_stock: opts.track ?? true }).select("id").single();
  if (opts.onHand && opts.actor) {
    const posting_date = opts.daysAgo ? new Date(Date.now() - opts.daysAgo * 86400 * 1000).toISOString() : new Date().toISOString();
    await (client as any).from("stock_movements").insert({
      variant_id: v.id, quantity_delta: opts.onHand, reason: "opening_balance", reference_type: "manual", actor_id: opts.actor, posting_date,
    });
  }
  return v.id;
}

beforeAll(async () => {
  session = await loginTestUser(`http://localhost:${process.env.PORT || "5000"}`, generatePhone());
  actorId = session.userId;
});
afterAll(async () => {
  if (session) { await setRole("customer"); await cleanupTestUser(session.userId); }
});

describe("Phase M4 Stock Signals Integration Tests", () => {
  it("1. trg_apply_stock_movement raises ST030 on non-tracked variant movement inserts", async () => {
    const ntId = await createVariant(db, { track: false });
    const { error } = await (db as any).from("stock_movements").insert({
      variant_id: ntId, quantity_delta: 5, reason: "opening_balance", reference_type: "manual", actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("ST030");
  });

  it("2. counter sales and order decrements with track_stock=false complete without stock_movements", async () => {
    const ntId = await createVariant(db, { track: false });
    const s = sale([{ variant_id: ntId, quantity: 2, price: 10 }]);
    const { data: saleData, error: saleErr } = await postSale(s);
    expect(saleErr).toBeNull();
    expect(saleData).toMatchObject({ status: "posted" });
    const { data: saleMv } = await (db as any).from("stock_movements").select("id").eq("transaction_id", s.id);
    expect(saleMv ?? []).toHaveLength(0);

    const orderId = randomUUID();
    const { error: orderErr } = await (db as any).rpc("decrement_order_stock", {
      p_order_id: orderId, p_lines: [{ variant_id: ntId, quantity: 3 }], p_actor_id: actorId,
    });
    expect(orderErr).toBeNull();
    const { data: orderMv } = await (db as any).from("stock_movements").select("id").eq("reference_type", "order").eq("reference_id", orderId);
    expect(orderMv ?? []).toHaveLength(0);

    const { data: v } = await (db as any).from("product_variants").select("on_hand").eq("id", ntId).single();
    expect(Number(v?.on_hand)).toBe(0);
  });

  it("3. cost privacy RLS: GET /admin/inventory/signals/dead-stock strips unit_cost/capital_tied_up for staff", async () => {
    const deadVarId = await createVariant(db, { onHand: 5, daysAgo: 100, actor: actorId });
    await (db as any).from("variant_costs").upsert({ variant_id: deadVarId, cost_price: 15.0, opening_cost: 15.0 });

    await setRole("staff");
    const staffRes = await call("GET", "/admin/inventory/signals/dead-stock?days=90");
    expect(staffRes.status).toBe(200);
    const staffJson = await staffRes.json();
    expect(staffJson).not.toHaveProperty("total_dead_capital");
    const staffVar = (staffJson.variants ?? []).find((v: any) => v.variant_id === deadVarId);
    if (staffVar) {
      expect(staffVar).not.toHaveProperty("unit_cost");
      expect(staffVar).not.toHaveProperty("capital_tied_up");
    }

    await setRole("admin");
    const adminRes = await call("GET", "/admin/inventory/signals/dead-stock?days=90");
    expect(adminRes.status).toBe(200);
    const adminJson = await adminRes.json();
    expect(typeof adminJson.total_dead_capital).toBe("number");
    const adminVar = (adminJson.variants ?? []).find((v: any) => v.variant_id === deadVarId);
    if (adminVar) {
      expect(adminVar).toHaveProperty("unit_cost");
      expect(adminVar).toHaveProperty("capital_tied_up");
    }
  });

  it("4. low stock digest queues one digest row in public.notifications and suppresses duplicate notifications until recovery", async () => {
    await setRole("admin");
    const lowVarId = await createVariant(db, { onHand: 2, actor: actorId });
    await (db as any).from("product_variants").update({ low_stock_threshold: 10 }).eq("id", lowVarId);
    await (db as any).from("low_stock_notification_events").delete().eq("variant_id", lowVarId);

    const res1 = await call("POST", "/admin/inventory/signals/evaluate-digest");
    expect(res1.status).toBe(200);
    expect((await res1.json()).evaluated).toBe(true);

    const { data: event1 } = await (db as any).from("low_stock_notification_events").select("variant_id").eq("variant_id", lowVarId).single();
    expect(event1).not.toBeNull();

    const { data: notifs1 } = await (db as any).from("notifications").select("id, payload, channel").eq("type", "low_stock");
    const matched1 = (notifs1 ?? []).filter((n: any) => (n.payload?.items ?? []).some((i: any) => i.variant_id === lowVarId));
    expect(matched1).toHaveLength(1);
    expect(matched1[0].channel).toBe("in_app");

    await call("POST", "/admin/inventory/signals/evaluate-digest");
    const { data: notifs2 } = await (db as any).from("notifications").select("id, payload").eq("type", "low_stock");
    const matched2 = (notifs2 ?? []).filter((n: any) => (n.payload?.items ?? []).some((i: any) => i.variant_id === lowVarId));
    expect(matched2).toHaveLength(1);

    await (db as any).from("stock_movements").insert({
      variant_id: lowVarId, quantity_delta: 20, reason: "manual_adjustment", reference_type: "manual", actor_id: actorId,
    });
    await call("POST", "/admin/inventory/signals/evaluate-digest");
    const { data: eventCleared } = await (db as any).from("low_stock_notification_events").select("variant_id").eq("variant_id", lowVarId);
    expect(eventCleared ?? []).toHaveLength(0);

    await (db as any).from("stock_movements").insert({
      variant_id: lowVarId, quantity_delta: -20, reason: "manual_adjustment", reference_type: "manual", actor_id: actorId,
    });
    await call("POST", "/admin/inventory/signals/evaluate-digest");
    const { data: notifs3 } = await (db as any).from("notifications").select("id, payload").eq("type", "low_stock");
    const matched3 = (notifs3 ?? []).filter((n: any) => (n.payload?.items ?? []).some((i: any) => i.variant_id === lowVarId));
    expect(matched3).toHaveLength(2);
  });

  it("5. reorder suggestions returns honest formula evidence and preserves candidates with sales_count < 3 with has_enough_data=false", async () => {
    await setRole("admin");
    const vFew = await createVariant(db, { onHand: 3, actor: actorId });
    const vEnough = await createVariant(db, { onHand: 7, actor: actorId });

    await (db as any).from("stock_movements").insert({
      variant_id: vFew, quantity_delta: -2, reason: "counter_sale", reference_type: "counter_sale",
      transaction_id: randomUUID(), actor_id: actorId,
    });

    for (let i = 0; i < 3; i++) {
      await (db as any).from("stock_movements").insert({
        variant_id: vEnough, quantity_delta: -2, reason: "counter_sale", reference_type: "counter_sale",
        transaction_id: randomUUID(), actor_id: actorId,
      });
    }

    const res = await call("GET", "/admin/inventory/signals/reorder?windowDays=28&targetDays=60&minSales=3");
    expect(res.status).toBe(200);
    const { suggestions } = (await res.json()) as { suggestions: any[] };

    const cand1 = suggestions.find((s) => s.variant_id === vFew);
    expect(cand1).toBeDefined();
    expect(cand1.has_enough_data).toBe(false);
    expect(cand1.suggested_qty).toBeNull();
    expect(Number(cand1.sales_count)).toBe(1);
    expect(Number(cand1.units_sold_window)).toBe(2);
    expect(Number(cand1.velocity)).toBeCloseTo(2 / 28, 4);

    const cand2 = suggestions.find((s) => s.variant_id === vEnough);
    expect(cand2).toBeDefined();
    expect(cand2.has_enough_data).toBe(true);
    expect(Number(cand2.suggested_qty)).toBe(12);
    expect(Number(cand2.sales_count)).toBe(3);
    expect(Number(cand2.units_sold_window)).toBe(6);
    expect(Number(cand2.velocity)).toBeCloseTo(6 / 28, 4);

    await setRole("staff");
    const staffRes = await call("GET", "/admin/inventory/signals/reorder");
    expect(staffRes.status).toBe(403);
  });
});
