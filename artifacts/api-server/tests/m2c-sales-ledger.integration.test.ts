import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

/**
 * M2c sales against the live ledger (migrations 20261111110000 and 20261111110100):
 * - fulfil_reservation succeeds end to end (its 'reservation' reference_type used to
 *   violate stock_movements_reference_type_check, so every pick-up rolled back);
 * - both sale paths leave a stock_movement_costs row, so the margin report sees the
 *   sale without waiting for the next replay.
 * Runs in CI `integration-e2e` (api-integration project).
 */
// Untyped: the generated Database types predate these RPCs' current signatures.
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let actorId: string;
let variantId: string;
let reservationId: string;

async function costRowFor(reference: string, reason: string) {
  const { data: mv, error } = await db
    .from("stock_movements")
    .select("id")
    .eq("variant_id", variantId)
    .eq("reason", reason)
    .eq("reference_id", reference)
    .single();
  expect(error).toBeNull();
  const { data: cost } = await db.from("stock_movement_costs").select("movement_id").eq("movement_id", mv!.id);
  return cost ?? [];
}

beforeAll(async () => {
  const { data: user, error: userErr } = await db.from("users").select("id").limit(1).single();
  if (userErr || !user) throw new Error(`No user to act as: ${userErr?.message}`);
  actorId = user.id;

  const stamp = Date.now();
  const { data: product, error: prodErr } = await db
    .from("products")
    .insert({ slug: `m2c-sales-int-${stamp}`, price: 10, stock: 0 })
    .select("id")
    .single();
  if (prodErr || !product) throw new Error(`product: ${prodErr?.message}`);
  // Ledger rows are append-only, so this product stays in the test project for good.
  // A translation keeps it harmless to storefront E2E tests that list it.
  await db.from("product_translations").insert({ product_id: product.id, lang_code: "az", title: "M2c Satış Test Məhsulu" });

  const { data: variant, error: varErr } = await db
    .from("product_variants")
    .insert({ product_id: product.id, sku: `M2C-SALES-${stamp}`, price: 10, on_hand: 0 })
    .select("id")
    .single();
  if (varErr || !variant) throw new Error(`variant: ${varErr?.message}`);
  variantId = variant.id;

  const { error: openErr } = await db.from("stock_movements").insert({
    variant_id: variantId, quantity_delta: 5, reason: "opening_balance", reference_type: "manual", actor_id: actorId,
  });
  if (openErr) throw new Error(`opening balance: ${openErr.message}`);

  const { data: res, error: resErr } = await db
    .from("reservations")
    .insert({
      reservation_number: `RES-INT-${stamp}`, variant_id: variantId, quantity: 1,
      customer_name: "Test", customer_phone: "+994000000000",
      agreed_price: 10, paid_amount: 4, created_by: actorId,
    })
    .select("id")
    .single();
  if (resErr || !res) throw new Error(`reservation: ${resErr?.message}`);
  reservationId = res.id;
});

afterAll(async () => {
  if (reservationId) await db.from("reservations").delete().eq("id", reservationId);
});

describe("M2c sales against the live ledger", () => {
  it("fulfil_reservation posts the pick-up and values it", async () => {
    const { error } = await db.rpc("fulfil_reservation", {
      p_reservation_id: reservationId, p_actor_id: actorId, p_final_payment: 6,
    });
    expect(error).toBeNull();

    const { data: res } = await db.from("reservations").select("status, paid_amount").eq("id", reservationId).single();
    expect(res).toMatchObject({ status: "fulfilled", paid_amount: 10 });
    expect(await costRowFor(reservationId, "counter_sale")).toHaveLength(1);
  });

  it("decrement_order_stock values the online sale", async () => {
    const orderId = randomUUID();
    const { error } = await db.rpc("decrement_order_stock", {
      p_order_id: orderId, p_lines: [{ variant_id: variantId, quantity: 1 }], p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(await costRowFor(orderId, "online_sale")).toHaveLength(1);
  });
});
