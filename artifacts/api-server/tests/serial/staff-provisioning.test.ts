import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { loginTestUser, type AuthSession } from "../helpers/auth";
import { generatePhone } from "../helpers/isolation";

/**
 * Staff provisioning, against the real test project and the running API (CI serial step).
 *
 * `users.id` references `auth.users`, so every user is created through the auth admin API
 * (the `trg_new_user` trigger adds the `users` row). The project holds many admins, so the
 * last-admin guard is exercised by demoting *all* of them at once — one statement for the
 * service-role case, two concurrent halves for the race — and anything changed is restored.
 */
const ORIGIN = `http://localhost:${process.env.PORT || "5000"}`;
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let adminSession: AuthSession;
let actorId: string;
let adminIdsBefore: string[] = [];

async function createUser(phone: string, fullName: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ phone, phone_confirm: true });
  if (error || !data.user) throw new Error(`auth createUser: ${error?.message}`);
  const { error: upErr } = await db.from("users").upsert({ id: data.user.id, phone, full_name: fullName }, { onConflict: "id" });
  if (upErr) throw new Error(`users upsert: ${upErr.message}`);
  return data.user.id;
}

async function setRole(userId: string, role: "customer" | "staff" | "admin"): Promise<void> {
  const { error } = await db.rpc("set_user_role", { p_actor: actorId, p_user: userId, p_role: role });
  if (error) throw new Error(`set_user_role: ${error.message}`);
}

async function adminIds(): Promise<string[]> {
  const { data, error } = await db.from("users").select("id").eq("role", "admin");
  if (error) throw new Error(error.message);
  return (data ?? []).map((u) => u.id);
}

function api(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${ORIGIN}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

describe("Staff provisioning serial integration suite", () => {
  beforeAll(async () => {
    adminSession = await loginTestUser(ORIGIN, "+994550000001");
    actorId = adminSession.userId;
    adminIdsBefore = await adminIds();
    expect(adminIdsBefore).toContain(actorId);
  });

  afterAll(async () => {
    // Safety net: if the guard ever failed, put every admin back (promotion is not guarded).
    const now = new Set(await adminIds());
    const lost = adminIdsBefore.filter((id) => !now.has(id));
    if (lost.length) await db.from("users").update({ role: "admin" }).in("id", lost);
  });

  it("provisions new phone as staff and records audit log", async () => {
    const newUserId = await createUser(generatePhone(), "Test Staff Member");

    const { data: oldRole, error: rpcErr } = await db.rpc("set_user_role", {
      p_actor: actorId,
      p_user: newUserId,
      p_role: "staff",
    });
    expect(rpcErr).toBeNull();
    expect(oldRole).toBe("customer");

    const { data: user } = await db.from("users").select("role").eq("id", newUserId).single();
    expect(user?.role).toBe("staff");

    const { data: auditLogs } = await db
      .from("audit_log")
      .select("actor_id, changes")
      .eq("entity_id", newUserId)
      .eq("action", "change_user_role");
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs![0].actor_id).toBe(actorId);
    expect(auditLogs![0].changes).toMatchObject({ old_role: "customer", new_role: "staff" });
  });

  it("promotes customer to staff while keeping existing orders intact", async () => {
    const phone = generatePhone();
    const custId = await createUser(phone, "Customer With Orders");

    const { data: order, error: orderErr } = await db
      .from("orders")
      .insert({
        user_id: custId,
        customer_name: "Customer With Orders",
        customer_phone: phone,
        delivery_address: "123 Main St",
        subtotal_azn: 50,
        discount_azn: 0,
        total_azn: 50,
        status: "pending",
      })
      .select("id")
      .single();
    expect(orderErr).toBeNull();

    const res = await api("/admin/users", adminSession.accessToken, {
      method: "POST",
      body: JSON.stringify({ phone, role: "staff" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(custId);

    const { data: user } = await db.from("users").select("role").eq("id", custId).single();
    expect(user?.role).toBe("staff");

    const { data: orders } = await db.from("orders").select("id").eq("user_id", custId);
    expect(orders).toEqual([{ id: order!.id }]);
  });

  it("refuses duplicate creation when same phone provided in alternate format", async () => {
    const phone = generatePhone();
    const first = await api("/admin/users", adminSession.accessToken, {
      method: "POST",
      body: JSON.stringify({ phone, full_name: "Staff Alternate Format", role: "staff" }),
    });
    expect(first.status).toBe(201);

    // Same number in the national 0-prefixed form: normalized to the same account.
    const national = "0" + phone.slice(4);
    const second = await api("/admin/users", adminSession.accessToken, {
      method: "POST",
      body: JSON.stringify({ phone: national, role: "staff" }),
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("already_staff");

    const { data: rows } = await db.from("users").select("id").in("phone", [phone, phone.slice(1)]);
    expect(rows).toHaveLength(1);
  });

  it("demoting the only admin is refused by the database trigger ST040 for service role", async () => {
    // One service-role statement that would leave zero admins: the AFTER trigger raises and the
    // whole statement rolls back, so nothing changes.
    const { error } = await db.from("users").update({ role: "customer" }).eq("role", "admin");
    expect(error?.code).toBe("ST040");
    expect((await adminIds()).sort()).toEqual([...adminIdsBefore].sort());
  });

  it("two concurrent cross-demotions via Promise.all leave at least one admin", async () => {
    // Two halves, each harmless alone, together leaving zero admins. The advisory lock serialises
    // the checks, so exactly one of the two statements is refused.
    const ids = await adminIds();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const half = Math.ceil(ids.length / 2);
    const [a, b] = [ids.slice(0, half), ids.slice(half)];

    const [r1, r2] = await Promise.all([
      db.from("users").update({ role: "customer" }).in("id", a),
      db.from("users").update({ role: "customer" }).in("id", b),
    ]);
    const refused = [r1.error?.code, r2.error?.code].filter((c) => c === "ST040");
    expect(refused).toHaveLength(1);
    expect((await adminIds()).length).toBeGreaterThanOrEqual(1);

    // Restore the half that was demoted (promotion is not guarded).
    const demoted = r1.error ? b : a;
    const { error: restoreErr } = await db.from("users").update({ role: "admin" }).in("id", demoted);
    expect(restoreErr).toBeNull();
  });

  it("demoted staff member's next admin request returns 403", async () => {
    const phone = generatePhone();
    const staffId = await createUser(phone, "Demoted Staff");
    await setRole(staffId, "staff");
    const staff = await loginTestUser(ORIGIN, phone);

    expect((await api("/admin/counter/bundles", staff.accessToken)).status).toBe(200);
    await setRole(staffId, "customer");
    expect((await api("/admin/counter/bundles", staff.accessToken)).status).toBe(403);
  });
});
