import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";

/**
 * Typed RPC wrappers (R16.3 / design §12).
 *
 * Centralizes every Supabase RPC call behind a typed, named function so call
 * sites stay clean and the project's "stock-change-via-RPC" steering rule is
 * honored in one place. Each wrapper invokes the SAME underlying Postgres RPC
 * with IDENTICAL args as today's inline call sites (R16.4):
 *   - decrementStockSafe → `decrement_stock_safe` { p_product_id, p_qty }
 *       (matches routes/orders.ts)
 *   - incrementStock     → `increment_stock`      { p_product_id, p_qty }
 *       (matches routes/admin.ts)
 *   - searchProducts     → `search_products`      { query_text, lang_code }
 *       (matches storefront SearchPage.tsx)
 *
 * NOTE on the localized `as any` casts: `decrement_stock_safe` and
 * `increment_stock` are NOT present in the generated
 * `Database["public"]["Functions"]` type (only `search_products`, `show_limit`,
 * and `show_trgm` were generated). To keep call sites fully typed and free of
 * casts, the cast is localized to this single file — the wrappers expose typed
 * public signatures while internally casting the client to reach the untyped
 * RPC. `search_products` IS in the generated type, so it needs no cast.
 *
 * This module only defines the wrappers; call-site migration is task 17.5.
 */

/**
 * Atomically decrement product stock via the `decrement_stock_safe` RPC.
 * Mirrors the inline call in routes/orders.ts exactly.
 */
export async function decrementStockSafe(
  c: SupabaseClient<Database>,
  productId: string,
  qty: number,
): Promise<{ error: unknown }> {
  // decrement_stock_safe is absent from the generated Functions type; cast
  // localized here so call sites remain typed (see module note).
  const { error } = await (c as any).rpc("decrement_stock_safe", {
    p_product_id: productId,
    p_qty: qty,
  });
  return { error };
}

/**
 * Atomically increment product stock via the `increment_stock` RPC.
 * Mirrors the inline call in routes/admin.ts exactly.
 */
export async function incrementStock(
  c: SupabaseClient<Database>,
  productId: string,
  qty: number,
): Promise<{ error: unknown }> {
  // increment_stock is absent from the generated Functions type; cast
  // localized here so call sites remain typed (see module note).
  const { error } = await (c as any).rpc("increment_stock", {
    p_product_id: productId,
    p_qty: qty,
  });
  return { error };
}

/**
 * Full-text product search via the `search_products` RPC.
 * Mirrors the inline call in storefront SearchPage.tsx exactly:
 * `rpc("search_products", { query_text, lang_code })`.
 *
 * `search_products` IS present in the generated `Functions` type, so this call
 * is fully typed (no cast). The underlying RPC requires both `query_text` and
 * `lang_code`, so `locale` is accepted to preserve identical args (R16.4); the
 * design §12 sketch (`searchProducts(c, term)`) is widened by this required
 * parameter.
 */
export async function searchProducts(
  c: SupabaseClient<Database>,
  term: string,
  locale: string,
): Promise<{ data: unknown; error: unknown }> {
  const { data, error } = await c.rpc("search_products", {
    query_text: term,
    lang_code: locale,
  });
  return { data, error };
}
