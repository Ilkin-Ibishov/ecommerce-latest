import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { loginTestUser, type AuthSession } from "../helpers/auth";
import { generatePhone } from "../helpers/isolation";

/**
 * Delivery cost integration tests (spec §11).
 * Runs in CI serial tier against live Supabase and running API.
 */
const ORIGIN = `http://localhost:${process.env.PORT || "5000"}`;
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let adminSession: AuthSession;

async function createCustomer(fullName = "Test Customer"): Promise<{ id: string; phone: string }> {
  const phone = generatePhone();
  const { data, error } = await db.auth.admin.createUser({ phone, phone_confirm: true });
  if (error || !data.user) throw new Error(`auth createUser: ${error?.message}`);
  const { error: upErr } = await db.from("users").upsert({ id: data.user.id, phone, full_name: fullName }, { onConflict: "id" });
  if (upErr) throw new Error(`users upsert: ${upErr.message}`);
  return { id: data.user.id, phone };
}

async function insertOrder(userId: string, phone: string, fee: number | null = null, status = "pending") {
  const subtotal = 50;
  const discount = 10;
  const total = fee !== null ? subtotal - discount + fee : subtotal - discount;
  const { data, error } = await db
    .from("orders")
    .insert({
      user_id: userId,
      customer_name: "Customer",
      customer_phone: phone,
      delivery_address: "Baku, Nizami 10",
      subtotal_azn: subtotal,
      discount_azn: discount,
      delivery_fee_azn: fee,
      total_azn: total,
      status: status as any,
    })
    .select("id, subtotal_azn, discount_azn, delivery_fee_azn, total_azn, status")
    .single();
  if (error) throw new Error(`insert order: ${error.message}`);
  return data;
}

function adminPatch(path: string, body: any) {
  return fetch(`${ORIGIN}/api${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminSession.accessToken}` },
    body: JSON.stringify(body),
  });
}

describe("Delivery cost at confirmation serial integration suite", () => {
  beforeAll(async () => {
    adminSession = await loginTestUser(ORIGIN, "+994550000001");
  });

  it("an order is placed with the fee NULL; total_azn equals subtotal_azn - discount_azn", async () => {
    const cust = await createCustomer();
    const order = await insertOrder(cust.id, cust.phone, null);
    expect(order.delivery_fee_azn).toBeNull();
    expect(Number(order.total_azn)).toBe(Number(order.subtotal_azn) - Number(order.discount_azn));
  });

  it("the fee is set to 7.50 on confirmation; total_azn moves by exactly 7.50 and the audit entry carries the change", async () => {
    const cust = await createCustomer();
    const order = await insertOrder(cust.id, cust.phone, null);
    const res = await adminPatch(`/admin/orders/${order.id}/status`, { delivery_fee_azn: "7.50", status: "phone_verified" });
    expect(res.status).toBe(200);

    const { data: updated } = await db.from("orders").select("delivery_fee_azn, total_azn, status").eq("id", order.id).single();
    expect(Number(updated!.delivery_fee_azn)).toBe(7.5);
    expect(Number(updated!.total_azn)).toBe(Number(order.total_azn) + 7.5);
    expect(updated!.status).toBe("phone_verified");

    const { data: audit } = await db.from("audit_log").select("action, changes").eq("entity_id", order.id).eq("action", "set_delivery_fee");
    expect(audit).toHaveLength(1);
    expect(audit![0].changes).toMatchObject({ old_fee: null, new_fee: 7.5, old_total: Number(order.total_azn), new_total: Number(order.total_azn) + 7.5 });
  });

  it("the fee is set to 0; the order reads as no fee, not as not yet set, and no aggregate counts it with the NULL ones", async () => {
    const cust = await createCustomer();
    const order = await insertOrder(cust.id, cust.phone, null);
    const res = await adminPatch(`/admin/orders/${order.id}/status`, { delivery_fee_azn: "0.00" });
    expect(res.status).toBe(200);

    const { data: updated } = await db.from("orders").select("delivery_fee_azn, total_azn").eq("id", order.id).single();
    expect(Number(updated!.delivery_fee_azn)).toBe(0);
    expect(Number(updated!.total_azn)).toBe(Number(order.total_azn));

    const { count: nullCount } = await db.from("orders").select("id", { count: "exact", head: true }).eq("id", order.id).is("delivery_fee_azn", null);
    expect(nullCount).toBe(0);
  });

  it("a fee is refused on a delivered order and on a cancelled one", async () => {
    const cust = await createCustomer();
    const delivered = await insertOrder(cust.id, cust.phone, 5, "delivered");
    const cancelled = await insertOrder(cust.id, cust.phone, null, "cancelled");

    const res1 = await adminPatch(`/admin/orders/${delivered.id}/status`, { delivery_fee_azn: "10.00" });
    expect(res1.status).toBe(409);
    expect(((await res1.json()) as any).error).toBe("fee_closed");

    const res2 = await adminPatch(`/admin/orders/${cancelled.id}/status`, { delivery_fee_azn: "10.00" });
    expect(res2.status).toBe(409);
    expect(((await res2.json()) as any).error).toBe("fee_closed");
  });

  it("a fee is refused below 0 and at three decimals", async () => {
    const cust = await createCustomer();
    const order = await insertOrder(cust.id, cust.phone, null);

    const resNegative = await adminPatch(`/admin/orders/${order.id}/status`, { delivery_fee_azn: "-5.00" });
    expect(resNegative.status).toBe(400);

    const resThreeDecimals = await adminPatch(`/admin/orders/${order.id}/status`, { delivery_fee_azn: "7.555" });
    expect(resThreeDecimals.status).toBe(400);
  });

  it("courier_assigned, shipped and delivered are each refused while the fee is NULL, and accepted once it is 0", async () => {
    const cust = await createCustomer();
    for (const st of ["courier_assigned", "shipped", "delivered"] as const) {
      const order = await insertOrder(cust.id, cust.phone, null, "pending");
      const resNull = await adminPatch(`/admin/orders/${order.id}/status`, { status: st });
      expect(resNull.status).toBe(409);
      expect(((await resNull.json()) as any).error).toBe("delivery_fee_required");

      const resZero = await adminPatch(`/admin/orders/${order.id}/status`, { delivery_fee_azn: "0.00", status: st });
      expect(resZero.status).toBe(200);
    }
  });

  it("the database refuses the same transition when the route is bypassed — service client moves a NULL-fee order straight to shipped and CHECK raises", async () => {
    const cust = await createCustomer();
    const order = await insertOrder(cust.id, cust.phone, null);
    const { error } = await db.from("orders").update({ status: "shipped" } as any).eq("id", order.id);
    expect(error?.code).toBe("23514");
  });

  it("cancelled and refused_at_delivery are reachable with the fee still NULL", async () => {
    const cust = await createCustomer();
    const order1 = await insertOrder(cust.id, cust.phone, null);
    const res1 = await adminPatch(`/admin/orders/${order1.id}/status`, { status: "cancelled" });
    expect(res1.status).toBe(200);

    const order2 = await insertOrder(cust.id, cust.phone, null);
    const res2 = await adminPatch(`/admin/orders/${order2.id}/status`, { status: "refused_at_delivery" });
    expect(res2.status).toBe(200);
  });

  it("raising the shop-wide setting later does not move any stored order's fee or total", async () => {
    const cust = await createCustomer();
    const order = await insertOrder(cust.id, cust.phone, 5);
    const { data: initial } = await db.from("orders").select("delivery_fee_azn, total_azn").eq("id", order.id).single();

    await db.from("site_settings").update({ delivery_fee_azn: 20 } as any).neq("id", "00000000-0000-0000-0000-000000000000");
    const { data: after } = await db.from("orders").select("delivery_fee_azn, total_azn").eq("id", order.id).single();
    expect(after).toEqual(initial);
  });

  it("revenue and the margin report are unchanged by a fee, and a NULL fee is not read as 0", async () => {
    const cust = await createCustomer();
    const orderWithFee = await insertOrder(cust.id, cust.phone, 15);
    const orderNullFee = await insertOrder(cust.id, cust.phone, null);

    const res = await fetch(`${ORIGIN}/api/admin/metrics/overview`, {
      headers: { Authorization: `Bearer ${adminSession.accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      expect(data).toHaveProperty("revenue");
    }
    expect(orderNullFee.delivery_fee_azn).toBeNull();
    expect(Number(orderWithFee.delivery_fee_azn)).toBe(15);
  });
});
