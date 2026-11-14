import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@workspace/supabase-types";
import { randomUUID } from "node:crypto";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/** Phase M4 Stock Signals integration suite against live ledger & Express routes. */
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let session: AuthSession;
let actorId: string;

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
  it("1. a movement for a non-tracked variant is refused with ST030", async () => {
    const ntId = await createVariant(db, { track: false });
    const { error } = await db.from("stock_movements").insert({
      variant_id: ntId,
      quantity_delta: 5,
      reason: "opening_balance",
      reference_type: "manual",
      actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("ST030");
  });

  it("2. true -> false is refused with ST031, ST032 and ST033 in turn, and allowed when all three are clear", async () => {
    // 2a. ST031: on_hand <> 0
    const v1 = await createVariant(db, { track: true, onHand: 5, actor: actorId });
    const { error: err31 } = await db.from("product_variants").update({ track_stock: false }).eq("id", v1);
    expect(err31).not.toBeNull();
    expect(err31?.code).toBe("ST031");

    // 2b. ST032: open stocktake
    const v2 = await createVariant(db, { track: true });
    const { data: st, error: stErr } = await db.from("stocktakes").insert({ status: "draft", created_by: actorId }).select("id").single();
    expect(stErr).toBeNull();
    const { error: stlErr } = await db.from("stocktake_lines").insert({ stocktake_id: st!.id, variant_id: v2, counted_quantity: 0 });
    expect(stlErr).toBeNull();
    const { error: err32 } = await db.from("product_variants").update({ track_stock: false }).eq("id", v2);
    expect(err32).not.toBeNull();
    expect(err32?.code).toBe("ST032");

    // 2c. ST033: active reservation (regardless of expires_at per D3)
    const v3 = await createVariant(db, { track: true });
    const { data: resv, error: resvErr } = await db.from("reservations").insert({
      variant_id: v3,
      quantity: 1,
      status: "active",
      customer_name: "Test",
      customer_phone: "+994501234567",
      hold_type: "cart_hold",
      created_by: actorId,
    }).select("id").single();
    expect(resvErr).toBeNull();
    expect(resv).toBeDefined();
    const { error: err33 } = await db.from("product_variants").update({ track_stock: false }).eq("id", v3);
    expect(err33).not.toBeNull();
    expect(err33?.code).toBe("ST033");

    // 2d. Clean: on_hand=0, no open stocktake, no active reservation -> succeeds
    const vClean = await createVariant(db, { track: true });
    const { error: cleanErr } = await db.from("product_variants").update({ track_stock: false }).eq("id", vClean);
    expect(cleanErr).toBeNull();
  });

  it("3. a non-tracked variant is refused on a stocktake line (ST034)", async () => {
    const ntId = await createVariant(db, { track: false });
    const { data: st, error: stErr } = await db.from("stocktakes").insert({ status: "draft", created_by: actorId }).select("id").single();
    expect(stErr).toBeNull();
    const { error: lineErr } = await db.from("stocktake_lines").insert({ stocktake_id: st!.id, variant_id: ntId, counted_quantity: 1 });
    expect(lineErr).not.toBeNull();
    expect(lineErr?.code).toBe("ST034");
  });

  it("4. a counter sale with a non-tracked line posts, writes its counter_sale_payments row and writes no movement for that line", async () => {
    const ntId = await createVariant(db, { track: false });
    const s = sale([{ variant_id: ntId, quantity: 2, price: 10 }]);
    const { data: saleData, error: saleErr } = await postSale(s);
    expect(saleErr).toBeNull();
    expect(saleData).toMatchObject({ status: "posted" });

    // Check payment row exists
    const { data: pmts, error: pmtErr } = await db.from("counter_sale_payments").select("sale_id, amount, method").eq("sale_id", s.id);
    expect(pmtErr).toBeNull();
    expect(pmts).toHaveLength(1);
    expect(Number(pmts![0].amount)).toBe(20);

    // Check no movements recorded
    const { data: saleMv, error: mvErr } = await db.from("stock_movements").select("id").eq("transaction_id", s.id);
    expect(mvErr).toBeNull();
    expect(saleMv ?? []).toHaveLength(0);
  });

  it("5. a sale of a tracked variant, then the switch to non-tracked, then void_counter_sale: void succeeds and writes no movement", async () => {
    const varId = await createVariant(db, { track: true, onHand: 2, actor: actorId });
    const s = sale([{ variant_id: varId, quantity: 2, price: 10 }]);
    const { data: saleData, error: saleErr } = await postSale(s);
    expect(saleErr).toBeNull();
    expect(saleData).toMatchObject({ status: "posted" });

    // Now on_hand is 0, no stocktake, no reservation -> can switch to non-tracked
    const { error: flipErr } = await db.from("product_variants").update({ track_stock: false }).eq("id", varId);
    expect(flipErr).toBeNull();

    // Void the counter sale
    const { data: voidData, error: voidErr } = await db.rpc("void_counter_sale", {
      p_id: s.id,
      p_reason: "customer_return",
      p_session_user: actorId,
    });
    expect(voidErr).toBeNull();
    expect(voidData).toMatchObject({ status: "voided" });

    // No void movement was written for non-tracked variant
    const { data: voidMv, error: vMvErr } = await db
      .from("stock_movements")
      .select("id")
      .eq("transaction_id", s.id)
      .eq("reason", "counter_sale_void");
    expect(vMvErr).toBeNull();
    expect(voidMv ?? []).toHaveLength(0);
  });

  it("6. the availability view returns NULL available_quantity and track_stock = false for non-tracked variant", async () => {
    const ntId = await createVariant(db, { track: false });
    const { data: avail, error: availErr } = await (db as any)
      .from("product_variant_availability")
      .select("available_quantity, track_stock")
      .eq("variant_id", ntId)
      .single();
    expect(availErr).toBeNull();
    expect(avail?.track_stock).toBe(false);
    expect(avail?.available_quantity).toBeNull();
  });

  it("7. none of the three RPCs returns a non-tracked variant; anon and authenticated cannot execute them", async () => {
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

  it("8. one real sale plus two fully voided ones: has_enough_data is false", async () => {
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
      p_target_days: 60,
      p_min_sales: 3,
    });
    expect(rpcErr).toBeNull();
    const item = (rows ?? []).find((r: { variant_id: string }) => r.variant_id === varId);
    expect(item).toBeDefined();
    // Only 1 real non-voided transaction exists -> has_enough_data must be false
    expect(item?.has_enough_data).toBe(false);
  });
});
