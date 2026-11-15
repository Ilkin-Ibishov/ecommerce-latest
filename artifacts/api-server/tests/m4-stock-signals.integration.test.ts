import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@workspace/supabase-types";
import { randomUUID } from "node:crypto";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/** Phase M4 Stock Signals integration suite: RPCs, route endpoints, and RBAC privacy. */
const BASE = `http://localhost:${process.env.PORT || "5000"}/api`;
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let session: AuthSession;
let actorId: string;

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const setRole = (role: Database["public"]["Enums"]["user_role"]) =>
  db.from("users").update({ role }).eq("id", session.userId);

const sale = (lines: { variant_id: string; quantity: number; price: number }[], id = randomUUID()) => {
  const priced = lines.map((l, i) => ({
    line_no: i + 1,
    variant_id: l.variant_id,
    quantity: l.quantity,
    charged_unit_price: l.price,
    bundle_id: null,
    net_line_total: Math.round(l.quantity * l.price * 100) / 100,
  }));
  const total = Math.round(priced.reduce((s, l) => s + l.net_line_total * 100, 0)) / 100;
  return {
    id,
    sold_at: new Date().toISOString(),
    payment_method: "cash",
    note: null,
    displayed_total: total,
    bundle_discount: 0,
    owner_discount: 0,
    total_amount: total,
    lines: priced,
  };
};

const postSale = (s: ReturnType<typeof sale>, hash = "h-" + s.id) =>
  db.rpc("post_counter_sale", { p_sale: s as unknown as Json, p_payload_hash: hash, p_session_user: actorId });

async function createVariant(
  client: SupabaseClient<Database>,
  opts: { track?: boolean; daysAgo?: number; onHand?: number; actor?: string } = {}
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: p, error: pErr } = await client
    .from("products")
    .insert({ slug: `f-${stamp}`, price: 10, stock: 0, sort_order: 1_000_000 })
    .select("id")
    .single();
  expect(pErr).toBeNull();
  if (!p) throw new Error("Failed to create product");

  const { error: ptErr } = await client
    .from("product_translations")
    .insert({ product_id: p.id, lang_code: "az", title: `T ${stamp}` });
  expect(ptErr).toBeNull();

  const { data: v, error: vErr } = await client
    .from("product_variants")
    .insert({ product_id: p.id, sku: `F-${stamp}`, price: 10, on_hand: 0, track_stock: opts.track ?? true })
    .select("id")
    .single();
  expect(vErr).toBeNull();
  if (!v) throw new Error("Failed to create variant");

  if (opts.onHand && opts.actor) {
    const posting_date = opts.daysAgo
      ? new Date(Date.now() - opts.daysAgo * 86400 * 1000).toISOString()
      : new Date().toISOString();
    const { error: mvErr } = await client.from("stock_movements").insert({
      variant_id: v.id,
      quantity_delta: opts.onHand,
      reason: "opening_balance",
      reference_type: "manual",
      actor_id: opts.actor,
      posting_date,
    });
    expect(mvErr).toBeNull();
  }
  return v.id;
}

beforeAll(async () => {
  session = await loginTestUser(`http://localhost:${process.env.PORT || "5000"}`, generatePhone());
  actorId = session.userId;
});

afterAll(async () => {
  if (session) {
    await setRole("customer");
    await cleanupTestUser(session.userId);
  }
});

describe("Phase M4 Stock Signals Integration Tests", () => {
  it("1. cost privacy RLS: GET /admin/inventory/signals/dead-stock strips unit_cost/capital_tied_up for staff", async () => {
    const deadVarId = await createVariant(db, { onHand: 5, daysAgo: 100, actor: actorId });
    const { error: costErr } = await db.from("variant_costs").upsert({ variant_id: deadVarId, cost_price: 15.0, opening_cost: 15.0 });
    expect(costErr).toBeNull();

    await setRole("staff");
    const staffRes = await call("GET", "/admin/inventory/signals/dead-stock?days=90");
    expect(staffRes.status).toBe(200);
    const staffJson = (await staffRes.json()) as { total_dead_capital?: number; variants?: Record<string, unknown>[] };
    expect(staffJson).not.toHaveProperty("total_dead_capital");
    const staffVar = (staffJson.variants ?? []).find((v) => v.variant_id === deadVarId);
    if (staffVar) {
      expect(staffVar).not.toHaveProperty("unit_cost");
      expect(staffVar).not.toHaveProperty("capital_tied_up");
    }

    await setRole("admin");
    const adminRes = await call("GET", "/admin/inventory/signals/dead-stock?days=90");
    expect(adminRes.status).toBe(200);
    const adminJson = (await adminRes.json()) as { total_dead_capital?: number; variants?: Record<string, unknown>[] };
    expect(typeof adminJson.total_dead_capital).toBe("number");
    const adminVar = (adminJson.variants ?? []).find((v) => v.variant_id === deadVarId);
    if (adminVar) {
      expect(adminVar).toHaveProperty("unit_cost");
      expect(adminVar).toHaveProperty("capital_tied_up");
    }
  });

  it("2. reorder suggestions returns honest formula evidence and preserves candidates with sales_count < 3 with has_enough_data=false", async () => {
    await setRole("admin");
    const vFew = await createVariant(db, { onHand: 3, actor: actorId });
    const vEnough = await createVariant(db, { onHand: 7, actor: actorId });

    const { error: sm1Err } = await db.from("stock_movements").insert({
      variant_id: vFew,
      quantity_delta: -2,
      reason: "counter_sale",
      reference_type: "counter_sale",
      transaction_id: randomUUID(),
      actor_id: actorId,
    });
    expect(sm1Err).toBeNull();

    for (let i = 0; i < 3; i++) {
      const { error: sm2Err } = await db.from("stock_movements").insert({
        variant_id: vEnough,
        quantity_delta: -2,
        reason: "counter_sale",
        reference_type: "counter_sale",
        transaction_id: randomUUID(),
        actor_id: actorId,
      });
      expect(sm2Err).toBeNull();
    }

    const res = await call("GET", "/admin/inventory/signals/reorder?windowDays=28&targetDays=60&minSales=3");
    expect(res.status).toBe(200);
    interface ReorderItem {
      variant_id: string;
      has_enough_data: boolean;
      suggested_qty: number | null;
      sales_count: number;
      units_sold_window: number;
      velocity: number;
    }
    const { suggestions } = (await res.json()) as { suggestions: ReorderItem[] };

    const cand1 = suggestions.find((s) => s.variant_id === vFew);
    expect(cand1).toBeDefined();
    expect(cand1!.has_enough_data).toBe(false);
    expect(cand1!.suggested_qty).toBeNull();
    expect(Number(cand1!.sales_count)).toBe(1);
    expect(Number(cand1!.units_sold_window)).toBe(2);
    expect(Number(cand1!.velocity)).toBeCloseTo(2 / 28, 4);

    const cand2 = suggestions.find((s) => s.variant_id === vEnough);
    expect(cand2).toBeDefined();
    expect(cand2!.has_enough_data).toBe(true);
    expect(Number(cand2!.suggested_qty)).toBe(12);
    expect(Number(cand2!.sales_count)).toBe(3);
    expect(Number(cand2!.units_sold_window)).toBe(6);
    expect(Number(cand2!.velocity)).toBeCloseTo(6 / 28, 4);

    await setRole("staff");
    const staffRes = await call("GET", "/admin/inventory/signals/reorder");
    expect(staffRes.status).toBe(403);
  });

  it("3. none of the three RPCs returns a non-tracked variant; anon and authenticated cannot execute them", async () => {
    const ntId = await createVariant(db, { track: false });

    // Service role execution: verify ntId is never returned
    const { data: lowRows, error: lowErr } = await (db as any).rpc("get_low_stock_signals", { p_search: null, p_status: null });
    expect(lowErr).toBeNull();
    expect((lowRows ?? []).some((r: { variant_id: string }) => r.variant_id === ntId)).toBe(false);

    const { data: deadRows, error: deadErr } = await (db as any).rpc("get_dead_stock_signals", { p_days: 1 });
    expect(deadErr).toBeNull();
    expect((deadRows ?? []).some((r: { variant_id: string }) => r.variant_id === ntId)).toBe(false);

    const { data: reorderRows, error: reorderErr } = await (db as any).rpc("get_reorder_suggestions", {
      p_window_days: 28,
      p_target_days: 60,
      p_min_sales: 1,
    });
    expect(reorderErr).toBeNull();
    expect((reorderRows ?? []).some((r: { variant_id: string }) => r.variant_id === ntId)).toBe(false);

    // anon execution denied
    const anonClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error: anonLowErr } = await (anonClient as any).rpc("get_low_stock_signals", {});
    expect(anonLowErr).not.toBeNull();
    const { error: anonDeadErr } = await (anonClient as any).rpc("get_dead_stock_signals", {});
    expect(anonDeadErr).not.toBeNull();
    const { error: anonReorderErr } = await (anonClient as any).rpc("get_reorder_suggestions", {});
    expect(anonReorderErr).not.toBeNull();

    // authenticated execution denied
    const authClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
    });
    const { error: authLowErr } = await (authClient as any).rpc("get_low_stock_signals", {});
    expect(authLowErr).not.toBeNull();
    const { error: authDeadErr } = await (authClient as any).rpc("get_dead_stock_signals", {});
    expect(authDeadErr).not.toBeNull();
    const { error: authReorderErr } = await (authClient as any).rpc("get_reorder_suggestions", {});
    expect(authReorderErr).not.toBeNull();
  });

  it("4. one real sale plus two fully voided ones: has_enough_data is false", async () => {
    const varId = await createVariant(db, { track: true, onHand: 10, actor: actorId });

    // Sale 1: real active sale
    const s1 = sale([{ variant_id: varId, quantity: 1, price: 10 }]);
    const { error: s1Err } = await postSale(s1);
    expect(s1Err).toBeNull();

    // Sale 2: posted then voided
    const s2 = sale([{ variant_id: varId, quantity: 1, price: 10 }]);
    const { error: s2Err } = await postSale(s2);
    expect(s2Err).toBeNull();
    const { error: v2Err } = await db.rpc("void_counter_sale", { p_id: s2.id, p_reason: "voided", p_session_user: actorId });
    expect(v2Err).toBeNull();

    // Sale 3: posted then voided
    const s3 = sale([{ variant_id: varId, quantity: 1, price: 10 }]);
    const { error: s3Err } = await postSale(s3);
    expect(s3Err).toBeNull();
    const { error: v3Err } = await db.rpc("void_counter_sale", { p_id: s3.id, p_reason: "voided", p_session_user: actorId });
    expect(v3Err).toBeNull();

    // Call RPC with min_sales = 3
    const { data: rows, error: rpcErr } = await (db as any).rpc("get_reorder_suggestions", {
      p_window_days: 28,
      p_target_days: 100000,
      p_min_sales: 3,
    });
    expect(rpcErr).toBeNull();
    const item = (rows ?? []).find((r: { variant_id: string }) => r.variant_id === varId);
    expect(item).toBeDefined();
    // Only 1 real non-voided transaction exists -> has_enough_data must be false
    expect(item?.has_enough_data).toBe(false);
    expect(item?.sales_count).toBe(1);
  });

  it("5. cancelling an order nets velocity to zero so it is omitted from reorder suggestions", async () => {
    const varId = await createVariant(db, { track: true, onHand: 10, actor: actorId });
    const orderId = randomUUID();

    const { error: decErr } = await (db as any).rpc("decrement_order_stock", {
      p_order_id: orderId,
      p_lines: [{ variant_id: varId, quantity: 5 }],
      p_actor_id: actorId,
    });
    expect(decErr).toBeNull();

    const { error: incErr } = await (db as any).rpc("increment_stock", {
      p_product_id: varId,
      p_qty: 5,
      p_reference_id: orderId,
    });
    expect(incErr).toBeNull();

    const { data: rows, error: rpcErr } = await (db as any).rpc("get_reorder_suggestions", {
      p_window_days: 28,
      p_target_days: 100000,
      p_min_sales: 1,
    });
    expect(rpcErr).toBeNull();
    const item = (rows ?? []).find((r: { variant_id: string }) => r.variant_id === varId);
    expect(item).toBeUndefined();
  });
});
