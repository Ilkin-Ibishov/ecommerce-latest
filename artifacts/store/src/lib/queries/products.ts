import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@workspace/supabase-types";
import { PRODUCT_SELECT } from "./fragments";

/**
 * A product row with the embedded relations selected by {@link PRODUCT_SELECT}.
 * The embedded arrays mirror the inline query shape the store pages consume.
 */
export type ProductRow = Tables<"products"> & {
  product_images: Tables<"product_images">[];
  product_translations: Tables<"product_translations">[];
  product_categories: Pick<Tables<"product_categories">, "category_id">[];
};

export interface GetProductsArgs {
  offset?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
}

/**
 * Centralized product list query. Reproduces the inline behavior of the store
 * product pages: the shared {@link PRODUCT_SELECT} shape, `sort_order` ascending
 * ordering, `offset`/`limit` range paging, optional `search_text` ilike search,
 * and optional category filtering. Returns `{ rows, count }` so callers get the
 * exact-count total alongside the page of rows.
 */
export async function getProducts(
  client: SupabaseClient<Database>,
  args: GetProductsArgs = {},
): Promise<{ rows: ProductRow[]; count: number }> {
  const { offset = 0, limit = 24, search, categoryId } = args;

  // When filtering by category, switch the embedded relation to an inner join so
  // only products belonging to that category are returned, while keeping the same
  // selected columns (and therefore the same returned shape).
  const selectStr = categoryId
    ? PRODUCT_SELECT.replace("product_categories(category_id)", "product_categories!inner(category_id)")
    : PRODUCT_SELECT;

  let query = client.from("products").select(selectStr, { count: "exact" });

  if (search?.trim()) {
    query = query.ilike("search_text", `%${search.trim()}%`);
  }
  if (categoryId) {
    query = query.eq("product_categories.category_id", categoryId);
  }

  const { data, count } = await query
    .order("sort_order", { ascending: true })
    .range(offset, offset + limit - 1);

  return { rows: (data ?? []) as unknown as ProductRow[], count: count ?? 0 };
}
