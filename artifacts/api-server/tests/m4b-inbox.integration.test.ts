import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/**
 * M4b inbox integration tests:
 * - A held sale leaves the count when posted, with admin_inbox_seen unchanged
 * - A void is unread for another admin and not for voided_by
 * - A staff token gets the two counts, events: null, and no other key
 * - A shopper's token gets 403 on all three routes
 *
 * Runs in CI with Supabase and API server. Server-side filters only.
 */
const BASE = `http://localhost:${process.env.PORT || "5000"}/api`;
const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let adminSessionA: AuthSession;
let adminSessionB: AuthSession;

const call = (session: AuthSession, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const setRole = (userId: string, role: string) =>
  db.from("users").update({ role }).eq("id", userId);

beforeAll(async () => {
  const host = `http://localhost:${process.env.PORT || "5000"}`;
  adminSessionA = await loginTestUser(host, generatePhone());
  adminSessionB = await loginTestUser(host, generatePhone());
  await setRole(adminSessionA.userId, "admin");
  await setRole(adminSessionB.userId, "admin");
});

afterAll(async () => {
  if (adminSessionA) {
    await setRole(adminSessionA.userId, "customer");
    await cleanupTestUser(adminSessionA.userId);
  }
  if (adminSessionB) {
    await setRole(adminSessionB.userId, "customer");
    await cleanupTestUser(adminSessionB.userId);
  }
});

describe("M4b admin inbox integration", () => {
  it("a held sale leaves the count when posted, with admin_inbox_seen unchanged", async () => {
    // 1. Ensure seen marker exists for adminSessionA
    const initialSeenAt = new Date(Date.now() - 3600 * 1000).toISOString();
    await db.from("admin_inbox_seen").upsert({
      user_id: adminSessionA.userId,
      seen_at: initialSeenAt,
    });

    const resBefore = await call(adminSessionA, "GET", "/admin/inbox/count");
    expect(resBefore.status).toBe(200);
    const countBefore = (await resBefore.json()).count;

    // 2. Insert a held sale (needs_owner)
    const saleId = randomUUID();
    const { error: insertErr } = await db.from("counter_sales").insert({
      id: saleId,
      status: "needs_owner",
      sale_number: Math.floor(100000 + Math.random() * 900000),
      cashier_id: adminSessionA.userId,
      total_amount: 10,
      displayed_total: 10,
      payment_method: "cash",
      sold_at: new Date().toISOString(),
    });
    expect(insertErr).toBeNull();

    try {
      const resHeld = await call(adminSessionA, "GET", "/admin/inbox/count");
      expect(resHeld.status).toBe(200);
      const countHeld = (await resHeld.json()).count;
      expect(countHeld).toBe(countBefore + 1);

      // 3. Post the sale
      const { error: updateErr } = await db
        .from("counter_sales")
        .update({ status: "posted" })
        .eq("id", saleId);
      expect(updateErr).toBeNull();

      // 4. Verify count dropped back
      const resAfter = await call(adminSessionA, "GET", "/admin/inbox/count");
      expect(resAfter.status).toBe(200);
      const countAfter = (await resAfter.json()).count;
      expect(countAfter).toBe(countBefore);

      // 5. Verify admin_inbox_seen is unchanged
      const { data: markerRow } = await db
        .from("admin_inbox_seen")
        .select("seen_at")
        .eq("user_id", adminSessionA.userId)
        .single();
      expect(markerRow?.seen_at).toBe(initialSeenAt);
    } finally {
      await db.from("counter_sales").delete().eq("id", saleId);
    }
  });

  it("a void is unread for another admin and not for voided_by", async () => {
    // Set markers for both admins to 1 hour ago
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    await db.from("admin_inbox_seen").upsert({
      user_id: adminSessionA.userId,
      seen_at: oneHourAgo,
    });
    await db.from("admin_inbox_seen").upsert({
      user_id: adminSessionB.userId,
      seen_at: oneHourAgo,
    });

    // Create a voided sale voided by adminSessionA now
    const saleId = randomUUID();
    const saleNumber = Math.floor(100000 + Math.random() * 900000);
    const { error: insertErr } = await db.from("counter_sales").insert({
      id: saleId,
      status: "voided",
      sale_number: saleNumber,
      cashier_id: adminSessionA.userId,
      voided_by: adminSessionA.userId,
      voided_at: new Date().toISOString(),
      void_reason: "Customer changed mind",
      total_amount: 15,
      displayed_total: 15,
      payment_method: "cash",
      sold_at: new Date().toISOString(),
    });
    expect(insertErr).toBeNull();

    try {
      // Admin A (actor) views inbox: void event should NOT be unread
      const resA = await call(adminSessionA, "GET", "/admin/inbox");
      expect(resA.status).toBe(200);
      const dataA = await resA.json();
      const eventA = dataA.events?.find((e: any) => e.sale_number === saleNumber);
      expect(eventA).toBeDefined();
      expect(eventA.unread).toBe(false);

      // Admin B (different user) views inbox: void event MUST be unread
      const resB = await call(adminSessionB, "GET", "/admin/inbox");
      expect(resB.status).toBe(200);
      const dataB = await resB.json();
      const eventB = dataB.events?.find((e: any) => e.sale_number === saleNumber);
      expect(eventB).toBeDefined();
      expect(eventB.unread).toBe(true);
    } finally {
      await db.from("counter_sales").delete().eq("id", saleId);
    }
  });

  it("a staff token gets the two counts, events: null, and no other key", async () => {
    await setRole(adminSessionB.userId, "staff");
    try {
      const res = await call(adminSessionB, "GET", "/admin/inbox");
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.events).toBeNull();
      expect(Object.keys(body).sort()).toEqual(["events", "needs_you", "seen_at"]);

      const keys = body.needs_you.map((item: any) => item.key);
      expect(keys.sort()).toEqual(["holds_overdue", "low_stock"]);
    } finally {
      await setRole(adminSessionB.userId, "admin");
    }
  });

  it("a shopper's token gets 403 on all three routes", async () => {
    await setRole(adminSessionB.userId, "customer");
    try {
      const countRes = await call(adminSessionB, "GET", "/admin/inbox/count");
      expect(countRes.status).toBe(403);

      const inboxRes = await call(adminSessionB, "GET", "/admin/inbox");
      expect(inboxRes.status).toBe(403);

      const seenRes = await call(adminSessionB, "POST", "/admin/inbox/seen");
      expect(seenRes.status).toBe(403);
    } finally {
      await setRole(adminSessionB.userId, "admin");
    }
  });
});
