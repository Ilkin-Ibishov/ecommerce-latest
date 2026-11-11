import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * The M2c definer functions must not be callable with the public anon key
 * (migration 20261111100000). Before it, anyone could drain stock through
 * /rest/v1/rpc/decrement_order_stock and fulfil any reservation.
 * A permission error comes back before the function body runs, so random ids are fine.
 */
const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const id = "00000000-0000-0000-0000-000000000000";

describe("M2c definer functions are closed to anon", () => {
  it("decrement_order_stock", async () => {
    const { error } = await anon.rpc("decrement_order_stock", { p_order_id: id, p_lines: [], p_actor_id: null });
    expect(error?.code).toBe("42501");
  });

  it("fulfil_reservation", async () => {
    const { error } = await anon.rpc("fulfil_reservation", { p_reservation_id: id, p_actor_id: id, p_final_payment: 0 });
    expect(error?.code).toBe("42501");
  });
});
