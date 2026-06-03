import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { cleanupTestCoupon } from "./helpers/cleanup.js";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Track inserted coupon IDs for cleanup
const testCouponIds: string[] = [];

describe("Coupons Integration Tests", () => {
  beforeAll(async () => {
    // Insert a valid percentage coupon
    const { data: pctCoupon, error: pctError } = await admin
      .from("coupons")
      .insert({
        code: "TEST_10PCT",
        description: "10% off test coupon",
        discount_type: "percentage",
        discount_value: 10,
        is_active: true,
        min_order_amount: null,
        max_uses: null,
        used_count: 0,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      })
      .select("id")
      .single();

    if (pctError) {
      throw new Error(`Failed to insert TEST_10PCT coupon: ${pctError.message}`);
    }
    testCouponIds.push(pctCoupon.id);

    // Insert an expired coupon
    const { data: expiredCoupon, error: expiredError } = await admin
      .from("coupons")
      .insert({
        code: "TEST_EXPIRED",
        description: "Expired test coupon",
        discount_type: "fixed",
        discount_value: 5,
        is_active: true,
        used_count: 0,
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
      })
      .select("id")
      .single();

    if (expiredError) {
      throw new Error(`Failed to insert TEST_EXPIRED coupon: ${expiredError.message}`);
    }
    testCouponIds.push(expiredCoupon.id);
  });

  afterAll(async () => {
    for (const id of testCouponIds) {
      await cleanupTestCoupon(id);
    }
  });

  it("should return discount info when applying a valid coupon code", async () => {
    const res = await fetch(`${BASE_URL}/api/coupons/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "TEST_10PCT", subtotal: 100 }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("code", "TEST_10PCT");
    expect(body).toHaveProperty("discount_type", "percentage");
    expect(body).toHaveProperty("discount_value", 10);
    expect(body).toHaveProperty("discount_amount");
    expect(body.discount_amount).toBeGreaterThan(0);
  });

  it("should return the correct discount amount for a percentage coupon", async () => {
    const subtotal = 200;
    const res = await fetch(`${BASE_URL}/api/coupons/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "TEST_10PCT", subtotal }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    // 10% of 200 = 20
    expect(body.discount_amount).toBe(20);
  });

  it("should return an error for an invalid coupon code", async () => {
    const res = await fetch(`${BASE_URL}/api/coupons/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "TEST_NONEXISTENT", subtotal: 100 }),
    });

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/invalid|expired/i);
  });

  it("should return an error for an expired coupon code", async () => {
    const res = await fetch(`${BASE_URL}/api/coupons/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "TEST_EXPIRED", subtotal: 100 }),
    });

    // Expired coupons may return 400 or 404 depending on whether
    // the query filters them out or the expiry check catches them
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
