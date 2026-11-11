import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A product with one variant holding `onHand` units, posted as an opening_balance movement.
 * Ledger rows are append-only, so these rows stay in the test project for good. The az
 * translation and a sort_order past every real product keep them harmless to storefront E2E
 * tests, which open the first listed product and expect it to be in stock.
 */
const FIXTURE_SORT_ORDER = 1_000_000;
export async function createStockedVariant(
  db: SupabaseClient,
  actorId: string,
  onHand: number,
  price = 10,
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: product, error: prodErr } = await db
    .from("products").insert({ slug: `fixture-${stamp}`, price, stock: 0, sort_order: FIXTURE_SORT_ORDER }).select("id").single();
  if (prodErr || !product) throw new Error(`product: ${prodErr?.message}`);
  await db.from("product_translations").insert({ product_id: product.id, lang_code: "az", title: `Test məhsulu ${stamp}` });

  const { data: variant, error: varErr } = await db
    .from("product_variants").insert({ product_id: product.id, sku: `FIX-${stamp}`, price, on_hand: 0 }).select("id").single();
  if (varErr || !variant) throw new Error(`variant: ${varErr?.message}`);

  if (onHand > 0) {
    const { error } = await db.from("stock_movements").insert({
      variant_id: variant.id, quantity_delta: onHand, reason: "opening_balance", reference_type: "manual", actor_id: actorId,
    });
    if (error) throw new Error(`opening balance: ${error.message}`);
  }
  return variant.id;
}
