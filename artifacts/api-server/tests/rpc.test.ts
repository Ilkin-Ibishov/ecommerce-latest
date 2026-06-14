/**
 * Typed RPC Wrapper Tests
 *
 * Verifies the typed RPC wrappers in src/lib/rpc.ts forward to the correct
 * underlying Supabase RPC name with identical args, and return the RPC result
 * shape unchanged.
 *
 * Each test passes a fake client whose `.rpc(name, args)` is a vi.fn() that
 * records the call and resolves a fixed result — no real Supabase access.
 *
 * Validates: Requirements 16.4, 16.5 (design §12)
 */
import { describe, it, expect, vi } from "vitest";
import {
  decrementStockSafe,
  incrementStock,
  searchProducts,
} from "../src/lib/rpc.ts";

/** Build a fake Supabase client whose `.rpc` resolves a fixed result. */
function makeFakeClient(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as never, rpc };
}

describe("Typed RPC wrappers", () => {
  describe("decrementStockSafe", () => {
    it("calls decrement_stock_safe with mapped args and returns { error }", async () => {
      const error = { message: "boom" };
      const { client, rpc } = makeFakeClient({ data: null, error });

      const out = await decrementStockSafe(client, "p1", 3);

      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("decrement_stock_safe", {
        p_product_id: "p1",
        p_qty: 3,
      });
      expect(out).toEqual({ error });
    });

    it("returns { error: null } when the RPC succeeds", async () => {
      const { client } = makeFakeClient({ data: null, error: null });

      const out = await decrementStockSafe(client, "p1", 1);

      expect(out).toEqual({ error: null });
    });
  });

  describe("incrementStock", () => {
    it("calls increment_stock with mapped args and returns { error }", async () => {
      const error = { message: "nope" };
      const { client, rpc } = makeFakeClient({ data: null, error });

      const out = await incrementStock(client, "p2", 5);

      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("increment_stock", {
        p_product_id: "p2",
        p_qty: 5,
      });
      expect(out).toEqual({ error });
    });

    it("returns { error: null } when the RPC succeeds", async () => {
      const { client } = makeFakeClient({ data: null, error: null });

      const out = await incrementStock(client, "p2", 2);

      expect(out).toEqual({ error: null });
    });
  });

  describe("searchProducts", () => {
    it("calls search_products with mapped args and returns { data, error }", async () => {
      const data = [{ id: "x" }];
      const { client, rpc } = makeFakeClient({ data, error: null });

      const out = await searchProducts(client, "term", "az");

      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("search_products", {
        query_text: "term",
        lang_code: "az",
      });
      expect(out).toEqual({ data, error: null });
    });

    it("propagates an error result from the RPC", async () => {
      const error = { message: "search failed" };
      const { client } = makeFakeClient({ data: null, error });

      const out = await searchProducts(client, "term", "ru");

      expect(out).toEqual({ data: null, error });
    });
  });
});
