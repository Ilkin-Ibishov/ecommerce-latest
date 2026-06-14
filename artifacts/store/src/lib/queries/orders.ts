import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@workspace/supabase-types";

// The orders list select string, reproduced exactly from the inline admin query
// so the returned column set is unchanged.
const ORDERS_SELECT =
  "id, status, total_azn, discount_azn, customer_name, customer_phone, delivery_address, created_at";

/**
 * An order row as selected by the admin orders list — the subset of columns the
 * orders table renders.
 */
export type OrderRow = Pick<
  Tables<"orders">,
  | "id"
  | "status"
  | "total_azn"
  | "discount_azn"
  | "customer_name"
  | "customer_phone"
  | "delivery_address"
  | "created_at"
>;

export interface GetOrdersArgs {
  offset?: number;
  limit?: number;
  search?: string;
  status?: string;
}

/**
 * Centralized order list query. Reproduces the inline admin orders behavior:
 * the same selected columns, `created_at` descending ordering, `offset`/`limit`
 * range paging, optional `status` equality filter, and optional name/phone
 * search via an `or(...)` ilike. Returns `{ rows, count }` with the exact-count
 * total.
 */
export async function getOrders(
  client: SupabaseClient<Database>,
  args: GetOrdersArgs = {},
): Promise<{ rows: OrderRow[]; count: number }> {
  const { offset = 0, limit = 30, search, status } = args;

  let query = client.from("orders").select(ORDERS_SELECT, { count: "exact" });

  if (status) {
    query = query.eq("status", status as Database["public"]["Enums"]["order_status"]);
  }
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`customer_name.ilike.${term},customer_phone.ilike.${term}`);
  }

  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return { rows: (data ?? []) as unknown as OrderRow[], count: count ?? 0 };
}
