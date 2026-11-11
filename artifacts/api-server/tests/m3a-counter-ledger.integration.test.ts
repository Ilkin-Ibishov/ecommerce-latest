import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createStockedVariant } from "./helpers/stocked-variant.js";

/**
 * M3a counter functions against the live ledger (migrations 20261111120000-120700).
 * Calls the definer functions as Express does, with the service client. Pricing is done by
 * lib/counter-pricing in Express and unit-tested there; here every line is priced at list.
 * Runs in CI `integration-e2e` (api-integration project).
 */
const url = process.env.SUPABASE_URL!;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

let actor: string;

type Line = { variant_id: string; quantity: number; price: number };
function sale(lines: Line[], id = randomUUID()) {
  const priced = lines.map((l, i) => ({
    line_no: i + 1, variant_id: l.variant_id, quantity: l.quantity,
    charged_unit_price: l.price, bundle_id: null, net_line_total: Math.round(l.quantity * l.price * 100) / 100,
  }));
  const total = Math.round(priced.reduce((s, l) => s + l.net_line_total * 100, 0)) / 100;
  return {
    id, sold_at: new Date().toISOString(), payment_method: "cash", note: null,
    displayed_total: total, bundle_discount: 0, owner_discount: 0, total_amount: total, lines: priced,
  };
}
const post = (s: ReturnType<typeof sale>, hash = "h-" + s.id) =>
  db.rpc("post_counter_sale", { p_sale: s, p_payload_hash: hash, p_session_user: actor });
const onHand = async (v: string) =>
  Number((await db.from("product_variants").select("on_hand").eq("id", v).single()).data!.on_hand);
const movements = async (saleId: string) =>
  (await db.from("stock_movements").select("id, quantity_delta").eq("transaction_id", saleId)).data ?? [];

beforeAll(async () => {
  const { data } = await db.from("users").select("id").limit(1).single();
  actor = data!.id;
});

describe("M3a counter ledger", () => {
  it("posts header, lines, movements and cost rows atomically", async () => {
    const a = await createStockedVariant(db, actor, 5);
    const b = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: a, quantity: 2, price: 10 }, { variant_id: b, quantity: 1, price: 10 }]);
    const { data, error } = await post(s);
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "posted", replayed: false });
    const mv = await movements(s.id);
    expect(mv).toHaveLength(2);
    const costs = await db.from("stock_movement_costs").select("movement_id").in("movement_id", mv.map((m) => m.id));
    expect(costs.data).toHaveLength(2);
    expect(await onHand(a)).toBe(3);
  });

  it("replays the same sale and rejects a different payload under the same id", async () => {
    const v = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: v, quantity: 1, price: 10 }]);
    await post(s);
    const again = await post(s);
    expect(again.data).toMatchObject({ replayed: true });
    expect(await movements(s.id)).toHaveLength(1);
    const other = await post(s, "a-different-hash");
    expect(other.error?.code).toBe("ST020");
  });

  it("rejects line totals that do not add up", async () => {
    const v = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: v, quantity: 1, price: 10 }]);
    const { error } = await post({ ...s, total_amount: 99 });
    expect(error?.code).toBe("ST023");
  });

  it("stores a sale the on-hand guard refuses as needs_owner, then the owner posts it", async () => {
    const v = await createStockedVariant(db, actor, 0);
    const s = sale([{ variant_id: v, quantity: 1, price: 10 }]);
    const { data } = await post(s);
    expect(data).toMatchObject({ status: "needs_owner", needs_owner_reason: "on_hand" });
    expect(await movements(s.id)).toHaveLength(0);

    await db.from("stock_movements").insert({ variant_id: v, quantity_delta: 1, reason: "manual_adjustment", reference_type: "manual", actor_id: actor });
    const pending = await db.rpc("post_pending_counter_sale", { p_id: s.id, p_session_user: actor });
    expect(pending.error).toBeNull();
    expect(pending.data).toMatchObject({ status: "posted" });
    expect(await onHand(v)).toBe(0);
  });

  it("flags a sale that eats into reserved stock, computed by the server", async () => {
    const v = await createStockedVariant(db, actor, 2);
    const { error: resErr } = await db.from("reservations").insert({
      reservation_number: `RES-M3A-${Date.now()}`, variant_id: v, quantity: 1, customer_name: "Test",
      customer_phone: "+994000000000", agreed_price: 10, paid_amount: 0, created_by: actor,
    });
    expect(resErr).toBeNull();
    const { data } = await post(sale([{ variant_id: v, quantity: 2, price: 10 }]));
    expect(data).toMatchObject({ status: "posted", lines: [{ reservation_override: true, price_mismatch: false }] });
  });

  it("flags a charged price that differs from the list price", async () => {
    const v = await createStockedVariant(db, actor, 2, 10);
    const { data } = await post(sale([{ variant_id: v, quantity: 1, price: 8 }]));
    expect(data).toMatchObject({ lines: [{ price_mismatch: true }] });
  });

  it("two tills selling the last unit: one posts, the other waits and becomes needs_owner", async () => {
    const v = await createStockedVariant(db, actor, 1);
    const [r1, r2] = await Promise.all([post(sale([{ variant_id: v, quantity: 1, price: 10 }])), post(sale([{ variant_id: v, quantity: 1, price: 10 }]))]);
    const statuses = [r1.data, r2.data].map((d) => (d as { status: string }).status).sort();
    expect(statuses).toEqual(["needs_owner", "posted"]);
    expect(await onHand(v)).toBe(0);
  });

  it("a void nets units, revenue and cost to zero in the margin report", async () => {
    const v = await createStockedVariant(db, actor, 3);
    const s = sale([{ variant_id: v, quantity: 2, price: 10 }]);
    await post(s);
    const voided = await db.rpc("void_counter_sale", { p_id: s.id, p_reason: "wrong item", p_session_user: actor });
    expect(voided.error).toBeNull();
    expect((await movements(s.id)).reduce((t, m) => t + Number(m.quantity_delta), 0)).toBe(0);
    expect(await onHand(v)).toBe(3);

    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const { data: report, error: reportErr } = await db.rpc("get_margin_report", { p_start_date: from, p_end_date: to });
    expect(reportErr).toBeNull();
    expect((report ?? []).find((r: { variant_id: string }) => r.variant_id === v)).toBeUndefined();
  });

  it("a posted sale shows priced revenue in the margin report the same day", async () => {
    const v = await createStockedVariant(db, actor, 3);
    await post(sale([{ variant_id: v, quantity: 3, price: 3.33 }]));
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const { data: report, error: reportErr } = await db.rpc("get_margin_report", { p_start_date: from, p_end_date: to });
    expect(reportErr).toBeNull();
    const row = (report ?? []).find((r: { variant_id: string }) => r.variant_id === v);
    expect(row).toMatchObject({ units_sold: 3, revenue: 9.99, unpriced_units_out: 0 });
  });

  it("anon cannot call the counter functions or read the counter tables", async () => {
    const id = randomUUID();
    const calls = await Promise.all([
      anon.rpc("post_counter_sale", { p_sale: {}, p_payload_hash: "x", p_session_user: id }),
      anon.rpc("post_pending_counter_sale", { p_id: id, p_session_user: id }),
      anon.rpc("void_counter_sale", { p_id: id, p_reason: "x", p_session_user: id }),
      anon.rpc("counter_sale_json", { p_id: id }),
    ]);
    calls.forEach((c) => expect(c.error?.code).toBe("42501"));
    for (const table of ["counter_sales", "counter_sale_lines", "bundles", "bundle_lines"]) {
      const { data } = await anon.from(table).select("*").limit(1);
      expect(data ?? []).toEqual([]);
    }
  });
});
