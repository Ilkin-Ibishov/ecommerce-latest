import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createStockedVariant } from "../helpers/stocked-variant.js";

/**
 * M3a negative stock serial test (migrations 20261104190000, 20261111120000, 20261111120400).
 * Tests global allow_negative_stock = true behavior in isolation.
 * Runs in CI `integration-e2e` after parallel api-integration finishes.
 */
const url = process.env.SUPABASE_URL!;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let actor: string;
let settingsId: string;

type Line = { variant_id: string; quantity: number; price: number };
function sale(lines: Line[], id = randomUUID()) {
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
}

const post = (s: ReturnType<typeof sale>, hash = "h-" + s.id) =>
  db.rpc("post_counter_sale", { p_sale: s, p_payload_hash: hash, p_session_user: actor });

beforeAll(async () => {
  const { data: userData, error: userErr } = await db.from("users").select("id").limit(1).single();
  if (userErr || !userData) throw new Error(`actor lookup: ${userErr?.message}`);
  actor = userData.id;

  const { data: settings, error: settingsErr } = await db
    .from("site_settings")
    .select("id, allow_negative_stock")
    .limit(1)
    .single();
  if (settingsErr || !settings) throw new Error(`site_settings lookup: ${settingsErr?.message}`);
  settingsId = settings.id;
  if (settings.allow_negative_stock !== false) {
    throw new Error(`site_settings.allow_negative_stock is already ${settings.allow_negative_stock}; previous run left it on!`);
  }
});

afterAll(async () => {
  if (settingsId) {
    const { data: settings } = await db
      .from("site_settings")
      .select("allow_negative_stock")
      .eq("id", settingsId)
      .single();
    expect(settings?.allow_negative_stock).toBe(false);
  }
});

describe("M3a negative stock (serial)", () => {
  it("allows oversell with negative_stock_override when allow_negative_stock is on", async () => {
    const v = await createStockedVariant(db, actor, 1);
    try {
      const { error: onErr } = await db
        .from("site_settings")
        .update({ allow_negative_stock: true })
        .eq("id", settingsId);
      if (onErr) throw new Error(`enable allow_negative_stock: ${onErr.message}`);

      const s = sale([{ variant_id: v, quantity: 2, price: 10 }]);
      const { data, error } = await post(s);
      expect(error).toBeNull();
      expect(data).toMatchObject({ status: "posted" });

      const { data: varData } = await db.from("product_variants").select("on_hand").eq("id", v).single();
      expect(Number(varData!.on_hand)).toBe(-1);

      const { data: mvData } = await db
        .from("stock_movements")
        .select("id, quantity_delta, negative_stock_override")
        .eq("transaction_id", s.id);
      expect(mvData).toHaveLength(1);
      expect(mvData![0].negative_stock_override).toBe(true);
    } finally {
      await db
        .from("site_settings")
        .update({ allow_negative_stock: false })
        .eq("id", settingsId);
    }
  });
});
