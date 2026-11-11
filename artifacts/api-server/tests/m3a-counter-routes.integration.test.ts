import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";
import { createStockedVariant } from "./helpers/stocked-variant.js";

/**
 * M3a counter routes through Express: who may do what (M3 spec §13), staff never see the
 * owner-only flags, and a staff discount is ignored. Needs the API server (CI integration-e2e).
 */
const BASE = `http://localhost:${process.env.PORT || "5000"}/api`;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let session: AuthSession;
let variantId: string;

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const setRole = (role: string) => db.from("users").update({ role }).eq("id", session.userId);
const saleBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(), sold_at: new Date().toISOString(), payment_method: "cash", displayed_total: 20,
  lines: [{ variant_id: variantId, quantity: 2, charged_unit_price: 10 }], ...overrides,
});

beforeAll(async () => {
  session = await loginTestUser(`http://localhost:${process.env.PORT || "5000"}`, generatePhone());
  variantId = await createStockedVariant(db, session.userId, 20, 10);
});

afterAll(async () => {
  if (!session) return;
  // Ledger rows keep this user referenced, so it may survive cleanup: never leave it an admin.
  await setRole("customer");
  await cleanupTestUser(session.userId);
});

describe("M3a counter routes", () => {
  it("a shopper cannot use the till", async () => {
    await setRole("customer");
    expect((await call("POST", "/admin/counter/sales", saleBody())).status).toBe(403);
    expect((await call("GET", `/admin/counter/lookup?q=x`)).status).toBe(403);
  });

  it("staff post a sale, a resend replays it, and flags are hidden from staff", async () => {
    await setRole("staff");
    const body = saleBody();
    const first = await call("POST", "/admin/counter/sales", body);
    expect(first.status).toBe(201);
    const posted = await first.json();
    expect(posted.status).toBe("posted");
    expect(posted.lines[0]).not.toHaveProperty("price_mismatch");
    expect(posted).not.toHaveProperty("total_mismatch");

    expect((await call("POST", "/admin/counter/sales", body)).status).toBe(200);

    const detail = await (await call("GET", `/admin/counter/sales/${body.id}`)).json();
    expect(detail).not.toHaveProperty("payload_hash");
    expect(detail.lines[0]).not.toHaveProperty("reservation_override");
  });

  it("a staff owner-discount is ignored, not applied", async () => {
    await setRole("staff");
    const body = saleBody({ owner_discount: 5 });
    const res = await call("POST", "/admin/counter/sales", body);
    expect(res.status).toBe(201);
    const { data } = await db.from("counter_sales").select("owner_discount, total_amount").eq("id", body.id).single();
    expect(data).toMatchObject({ owner_discount: 0, total_amount: 20 });
  });

  it("staff cannot void, post pending, see flagged sales or edit bundles", async () => {
    await setRole("staff");
    const id = randomUUID();
    expect((await call("POST", `/admin/counter/sales/${id}/void`, { reason: "x" })).status).toBe(403);
    expect((await call("POST", `/admin/counter/sales/${id}/post-pending`)).status).toBe(403);
    expect((await call("GET", "/admin/counter/flagged")).status).toBe(403);
    expect((await call("POST", "/admin/bundles", { name: "x", lines: [{ variant_id: variantId, quantity: 1 }] })).status).toBe(403);
  });

  it("the owner applies a discount, sees flags, and voids with a reason", async () => {
    await setRole("admin");
    const body = saleBody({ owner_discount: 5, displayed_total: 15 });
    const posted = await (await call("POST", "/admin/counter/sales", body)).json();
    expect(posted).toMatchObject({ total_amount: 15, total_mismatch: false });
    expect(posted.lines[0]).toHaveProperty("price_mismatch", false);

    expect((await call("POST", `/admin/counter/sales/${body.id}/void`, {})).status).toBe(400);
    const voided = await call("POST", `/admin/counter/sales/${body.id}/void`, { reason: "wrong item" });
    expect(voided.status).toBe(200);
    expect((await voided.json()).status).toBe("voided");
  });

  it("the owner creates a bundle and the till prices it", async () => {
    await setRole("admin");
    const created = await call("POST", "/admin/bundles", { name: `Test box ${Date.now()}`, bundle_price: 15, lines: [{ variant_id: variantId, quantity: 2 }] });
    expect(created.status).toBe(201);
    const { id: bundleId } = await created.json();
    const body = saleBody({ displayed_total: 15, lines: [{ variant_id: variantId, quantity: 2, charged_unit_price: 10, bundle_id: bundleId }] });
    const posted = await (await call("POST", "/admin/counter/sales", body)).json();
    expect(posted).toMatchObject({ status: "posted", total_amount: 15, total_mismatch: false });
    expect((await call("DELETE", `/admin/bundles/${bundleId}`)).status).toBe(200);
  });
});
