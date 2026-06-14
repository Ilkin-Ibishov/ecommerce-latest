/**
 * Data-layer shape tests for the `lib/queries/` wrappers (architecture-refactoring R7.5).
 *
 * These wrappers (`getProducts`, `getCategoriesTree`, `getOrders`) build Supabase
 * query-builder chains. We exercise them against a MOCKED Supabase client: a fake
 * `SupabaseClient<Database>`-shaped object whose
 * `.from().select().order().range()/.eq()/.or()/.ilike()` chain is a chainable
 * stub that records each call and resolves (it is thenable) to a fixed
 * `{ data, count }`. We then assert the returned `{ rows, count }` shape AND that
 * the chain received the expected select / filter / order / range calls.
 *
 * No DOM is needed — pure logic against a mocked client — so this runs under the
 * `store-unit` (node env) vitest project.
 *
 * _Requirements: 7.5_
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { getProducts } from "@/lib/queries/products";
import { getCategoriesTree } from "@/lib/queries/categories";
import { getOrders } from "@/lib/queries/orders";
import { PRODUCT_SELECT, CATEGORY_TREE_SELECT } from "@/lib/queries/fragments";

interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * Build a chainable query-builder stub that records every call and, because it
 * is thenable, resolves to the provided `{ data, count }` when awaited at the
 * end of the chain.
 */
function makeClient(result: { data: unknown; count: number | null }) {
  const calls: RecordedCall[] = [];

  const builder: Record<string, unknown> = {};
  const chain = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };

  for (const method of ["select", "ilike", "eq", "or", "order", "range"]) {
    builder[method] = chain(method);
  }
  // Make the builder awaitable: `await query.order(...).range(...)` resolves here.
  builder.then = (
    onFulfilled: (v: { data: unknown; count: number | null }) => unknown,
  ) => Promise.resolve(result).then(onFulfilled);

  const client = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    calls,
  };
}

/** First recorded call matching `method`, or undefined. */
function find(calls: RecordedCall[], method: string): RecordedCall | undefined {
  return calls.find((c) => c.method === method);
}

/** All recorded calls matching `method`. */
function all(calls: RecordedCall[], method: string): RecordedCall[] {
  return calls.filter((c) => c.method === method);
}

describe("lib/queries data layer", () => {
  describe("getProducts", () => {
    it("returns { rows, count } with rows mapped from data using the shared PRODUCT_SELECT", async () => {
      const data = [
        { id: "p1", slug: "shoe", price: 10, stock: 5, brand: "B", product_images: [], product_translations: [], product_categories: [] },
        { id: "p2", slug: "hat", price: 20, stock: 2, brand: "B", product_images: [], product_translations: [], product_categories: [] },
      ];
      const { client, calls } = makeClient({ data, count: 2 });

      const result = await getProducts(client);

      // Shape: rows are the data rows verbatim; count is the exact count.
      expect(result.rows).toEqual(data);
      expect(result.count).toBe(2);

      // Targets the products table.
      expect(find(calls, "from")?.args).toEqual(["products"]);

      // Uses the shared product select fragment with an exact count.
      expect(find(calls, "select")?.args).toEqual([PRODUCT_SELECT, { count: "exact" }]);

      // No search / category filters applied for the nominal call.
      expect(find(calls, "ilike")).toBeUndefined();
      expect(find(calls, "eq")).toBeUndefined();

      // Default ordering and default paging (offset 0, limit 24 -> range(0, 23)).
      expect(find(calls, "order")?.args).toEqual(["sort_order", { ascending: true }]);
      expect(find(calls, "range")?.args).toEqual([0, 23]);
    });

    it("defaults to empty rows and count 0 when the query yields null data/count", async () => {
      const { client } = makeClient({ data: null, count: null });
      const result = await getProducts(client);
      expect(result.rows).toEqual([]);
      expect(result.count).toBe(0);
    });

    it("applies an ilike on search_text when a search term is provided", async () => {
      const { client, calls } = makeClient({ data: [], count: 0 });
      await getProducts(client, { search: "  shoe  " });

      // Search term is trimmed and wrapped with %...% and applied to search_text.
      expect(find(calls, "ilike")?.args).toEqual(["search_text", "%shoe%"]);
    });

    it("does not apply ilike for a blank/whitespace-only search", async () => {
      const { client, calls } = makeClient({ data: [], count: 0 });
      await getProducts(client, { search: "   " });
      expect(find(calls, "ilike")).toBeUndefined();
    });

    it("switches to the !inner product_categories variant and applies the category eq when categoryId is set", async () => {
      const { client, calls } = makeClient({ data: [], count: 0 });
      await getProducts(client, { categoryId: "cat-1" });

      const expectedSelect = PRODUCT_SELECT.replace(
        "product_categories(category_id)",
        "product_categories!inner(category_id)",
      );
      expect(find(calls, "select")?.args).toEqual([expectedSelect, { count: "exact" }]);
      expect(find(calls, "eq")?.args).toEqual(["product_categories.category_id", "cat-1"]);
    });

    it("paginates with range using the provided offset/limit", async () => {
      const { client, calls } = makeClient({ data: [], count: 0 });
      await getProducts(client, { offset: 48, limit: 12 });
      // range(offset, offset + limit - 1) => range(48, 59)
      expect(find(calls, "range")?.args).toEqual([48, 59]);
    });
  });

  describe("getCategoriesTree", () => {
    it("assembles the root -> subcategories tree from a flat fixture", async () => {
      const flat = [
        { id: "a", slug: "a", parent_id: null, icon_url: null, category_translations: [{ name: "A" }] },
        { id: "b", slug: "b", parent_id: null, icon_url: null, category_translations: [{ name: "B" }] },
        { id: "a1", slug: "a1", parent_id: "a", icon_url: null, category_translations: [{ name: "A1" }] },
        { id: "a2", slug: "a2", parent_id: "a", icon_url: null, category_translations: [{ name: "A2" }] },
        { id: "b1", slug: "b1", parent_id: "b", icon_url: null, category_translations: [{ name: "B1" }] },
      ];
      const { client, calls } = makeClient({ data: flat, count: null });

      const roots = await getCategoriesTree(client);

      // Targets categories, uses the shared tree select, ordered by id ascending.
      expect(find(calls, "from")?.args).toEqual(["categories"]);
      expect(find(calls, "select")?.args).toEqual([CATEGORY_TREE_SELECT]);
      expect(find(calls, "order")?.args).toEqual(["id", { ascending: true }]);

      // Two roots, in input order.
      expect(roots.map((r) => r.id)).toEqual(["a", "b"]);

      // Children nested under their parents, in input order.
      expect(roots[0].subcategories.map((c) => c.id)).toEqual(["a1", "a2"]);
      expect(roots[1].subcategories.map((c) => c.id)).toEqual(["b1"]);

      // Leaf children carry an empty subcategories array and preserve translations.
      expect(roots[0].subcategories[0].subcategories).toEqual([]);
      expect(roots[0].category_translations).toEqual([{ name: "A" }]);
    });

    it("returns an empty array when there is no category data", async () => {
      const { client } = makeClient({ data: null, count: null });
      expect(await getCategoriesTree(client)).toEqual([]);
    });
  });

  describe("getOrders", () => {
    it("returns { rows, count } with default desc ordering and paging", async () => {
      const data = [
        { id: "o1", status: "pending", total_azn: 50, discount_azn: 0, customer_name: "Ann", customer_phone: "555", delivery_address: "X", created_at: "2024-01-01" },
      ];
      const { client, calls } = makeClient({ data, count: 1 });

      const result = await getOrders(client);

      expect(result.rows).toEqual(data);
      expect(result.count).toBe(1);

      expect(find(calls, "from")?.args).toEqual(["orders"]);
      // No status / search filters for the nominal call.
      expect(find(calls, "eq")).toBeUndefined();
      expect(find(calls, "or")).toBeUndefined();
      // created_at desc, default paging (offset 0, limit 30 -> range(0, 29)).
      expect(find(calls, "order")?.args).toEqual(["created_at", { ascending: false }]);
      expect(find(calls, "range")?.args).toEqual([0, 29]);
    });

    it("defaults to empty rows and count 0 when the query yields null data/count", async () => {
      const { client } = makeClient({ data: null, count: null });
      const result = await getOrders(client);
      expect(result.rows).toEqual([]);
      expect(result.count).toBe(0);
    });

    it("applies an eq on status when a status filter is provided", async () => {
      const { client, calls } = makeClient({ data: [], count: 0 });
      await getOrders(client, { status: "paid" });
      expect(find(calls, "eq")?.args).toEqual(["status", "paid"]);
    });

    it("applies an or(...) ilike across name and phone when a search term is provided", async () => {
      const { client, calls } = makeClient({ data: [], count: 0 });
      await getOrders(client, { search: "  john  " });
      expect(find(calls, "or")?.args).toEqual([
        "customer_name.ilike.%john%,customer_phone.ilike.%john%",
      ]);
    });

    it("does not apply or(...) for a blank/whitespace-only search", async () => {
      const { client, calls } = makeClient({ data: [], count: 0 });
      await getOrders(client, { search: "   " });
      expect(find(calls, "or")).toBeUndefined();
    });

    it("paginates with range using the provided offset/limit", async () => {
      const { client, calls } = makeClient({ data: [], count: 0 });
      await getOrders(client, { offset: 60, limit: 30 });
      // range(offset, offset + limit - 1) => range(60, 89)
      expect(find(calls, "range")?.args).toEqual([60, 89]);
      expect(all(calls, "range")).toHaveLength(1);
    });
  });
});
