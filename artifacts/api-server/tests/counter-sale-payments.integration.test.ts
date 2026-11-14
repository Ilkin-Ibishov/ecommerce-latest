import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createStockedVariant } from "./helpers/stocked-variant.js";

/**
 * Integration tests for counter_sale_payments chore (spec §6).
 * Verified against live Supabase during CI integration-e2e tier.
 */
const url = process.env.SUPABASE_URL!;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

let actor: string;

type Line = { variant_id: string; quantity: number; price: number };
function sale(lines: Line[], id = randomUUID(), paymentMethod = "cash") {
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
    payment_method: paymentMethod,
    note: null,
    displayed_total: total,
    bundle_discount: 0,
    owner_discount: 0,
    total_amount: total,
    lines: priced,
  };
}

const post = (s: ReturnType<typeof sale>, hash = "h-" + s.id) =>
  db.rpc("post_counter_sale", { p_sale: s, p_payload_hash: hash, p_session_user: actor });

beforeAll(async () => {
  const { data } = await db.from("users").select("id").limit(1).single();
  actor = data!.id;
});

describe("counter_sale_payments integration (spec §6)", () => {
  it("one-leg sale writes exactly one row equal to the total", async () => {
    const v = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: v, quantity: 2, price: 15.5 }], randomUUID(), "card");
    const { data, error } = await post(s);
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "posted" });

    const { data: payments } = await db.from("counter_sale_payments").select("*").eq("sale_id", s.id);
    expect(payments).toHaveLength(1);
    expect(payments![0]).toMatchObject({
      sale_id: s.id,
      method: "card",
      amount: 31,
    });
  });

  it("a hand-inserted two-leg split that sums correctly commits", async () => {
    const v = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: v, quantity: 1, price: 20 }], randomUUID(), "cash");
    const posted = await post(s);
    expect(posted.error).toBeNull();

    // Insert a second leg with amount = 0 and a different method (sum unchanged)
    const secondLeg = await db.from("counter_sale_payments").insert({
      sale_id: s.id,
      method: "card",
      amount: 0,
    });
    expect(secondLeg.error).toBeNull();

    const { data: payments } = await db.from("counter_sale_payments").select("*").eq("sale_id", s.id);
    expect(payments).toHaveLength(2);
    const sum = payments!.reduce((acc, p) => acc + Number(p.amount), 0);
    expect(sum).toBe(20);
  });

  it("a split that does not sum is refused at commit with ST027", async () => {
    const v = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: v, quantity: 1, price: 20 }], randomUUID(), "cash");
    const posted = await post(s);
    expect(posted.error).toBeNull();

    // Insert a second leg with amount > 0, breaking the sum constraint
    const badLeg = await db.from("counter_sale_payments").insert({
      sale_id: s.id,
      method: "card",
      amount: 5,
    });
    expect(badLeg.error).not.toBeNull();
    expect(badLeg.error?.code).toBe("ST027");

    const { data: payments } = await db.from("counter_sale_payments").select("*").eq("sale_id", s.id);
    expect(payments).toHaveLength(1);
    expect(payments![0].amount).toBe(20);
  });

  it("backfill produces one row per existing sale with matching sum", async () => {
    // Audit M1: no counter_sales row without a payment row, and no sale whose payments differ from its total (two count queries, both zero)
    type SaleWithPayments = {
      id: string;
      total_amount: number;
      counter_sale_payments: Array<{ sale_id: string; amount: number }>;
    };

    const { data: rawSales, error } = await db
      .from("counter_sales")
      .select("id, total_amount, counter_sale_payments(sale_id, amount)");
    expect(error).toBeNull();
    expect(rawSales).not.toBeNull();

    const sales = (rawSales ?? []) as unknown as SaleWithPayments[];

    const missingPayments = sales.filter(
      (s) => !s.counter_sale_payments || s.counter_sale_payments.length === 0
    );
    expect(missingPayments.length).toBe(0);

    const mismatchedSum = sales.filter((s) => {
      const sum = (s.counter_sale_payments ?? []).reduce(
        (acc, p) => acc + Number(p.amount),
        0
      );
      return Math.round(sum * 100) !== Math.round(Number(s.total_amount) * 100);
    });
    expect(mismatchedSum.length).toBe(0);
  });

  it("replaying post_counter_sale with the same id and hash writes no second row", async () => {
    const v = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: v, quantity: 1, price: 20 }]);
    const first = await post(s);
    expect(first.error).toBeNull();

    const replayed = await post(s);
    expect(replayed.error).toBeNull();
    expect(replayed.data).toMatchObject({ replayed: true });

    const { data: payments } = await db.from("counter_sale_payments").select("*").eq("sale_id", s.id);
    expect(payments).toHaveLength(1);
  });

  it("a voided sale keeps its payment rows", async () => {
    const v = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: v, quantity: 1, price: 12 }], randomUUID(), "other");
    const posted = await post(s);
    expect(posted.error).toBeNull();

    const voided = await db.rpc("void_counter_sale", { p_id: s.id, p_reason: "Customer change", p_session_user: actor });
    expect(voided.error).toBeNull();

    const { data: payments } = await db.from("counter_sale_payments").select("*").eq("sale_id", s.id);
    expect(payments).toHaveLength(1);
    expect(payments![0].amount).toBe(12);
    expect(payments![0].method).toBe("other");
  });

  it("an UPDATE or DELETE on a payment row is refused by trigger (2BP01)", async () => {
    const v = await createStockedVariant(db, actor, 5);
    const s = sale([{ variant_id: v, quantity: 1, price: 10 }]);
    const posted = await post(s);
    expect(posted.error).toBeNull();

    const updateAttempt = await db
      .from("counter_sale_payments")
      .update({ amount: 99 })
      .eq("sale_id", s.id);
    expect(updateAttempt.error?.code).toBe("2BP01");

    const deleteAttempt = await db
      .from("counter_sale_payments")
      .delete()
      .eq("sale_id", s.id);
    expect(deleteAttempt.error?.code).toBe("2BP01");
  });

  it("anon cannot write to counter_sale_payments or payment_methods", async () => {
    const saleId = randomUUID();
    const writeAttempt = await anon
      .from("counter_sale_payments")
      .insert({ sale_id: saleId, method: "cash", amount: 10 });
    expect(writeAttempt.error).not.toBeNull();

    const methodWrite = await anon
      .from("payment_methods")
      .insert({ code: "crypto", label: "Crypto", active: true });
    expect(methodWrite.error).not.toBeNull();
  });
});
