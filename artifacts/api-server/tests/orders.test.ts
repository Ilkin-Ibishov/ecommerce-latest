import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const TEST_PHONE = "+994501234003";

describe("Orders Integration Tests", () => {
  let session: AuthSession;
  let testProductId: string;
  let createdOrderId: string;

  const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  beforeAll(async () => {
    // Authenticate a test user
    session = await loginTestUser(BASE_URL, TEST_PHONE);

    // Fetch a product with sufficient stock for order creation
    const { data: product } = await admin
      .from("products")
      .select("id, stock")
      .gte("stock", 1)
      .limit(1)
      .single();

    if (!product) {
      throw new Error(
        "No products with stock found in the database. Seed products before running orders tests."
      );
    }

    testProductId = product.id;
  });

  afterAll(async () => {
    if (session?.userId) {
      await cleanupTestUser(session.userId);
    }
  });

  it("should create an order with an authenticated user", async () => {
    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        items: [{ product_id: testProductId, quantity: 1 }],
        customer_name: "Test User",
        customer_phone: TEST_PHONE,
        delivery_address: "123 Test Street, Baku",
      }),
    });

    expect(res.status).toBe(201);

    const body = (await res.json()) as { success: boolean; orderId: string };
    expect(body.success).toBe(true);
    expect(body.orderId).toBeDefined();
    expect(typeof body.orderId).toBe("string");
    expect(body.orderId.length).toBeGreaterThan(0);

    createdOrderId = body.orderId;
  });

  it("should retrieve the user's order list", async () => {
    const res = await fetch(`${BASE_URL}/api/profile/orders`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    expect(res.status).toBe(200);

    const orders = (await res.json()) as Array<{
      id: string;
      status: string;
      user_id: string;
      order_items: unknown[];
    }>;

    expect(Array.isArray(orders)).toBe(true);
    expect(orders.length).toBeGreaterThanOrEqual(1);

    // Verify the created order is in the list
    const found = orders.find((o) => o.id === createdOrderId);
    expect(found).toBeDefined();
  });

  it("should include order ID and status in the response", async () => {
    const res = await fetch(`${BASE_URL}/api/profile/orders`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    expect(res.status).toBe(200);

    const orders = (await res.json()) as Array<{
      id: string;
      status: string;
    }>;

    const order = orders.find((o) => o.id === createdOrderId);
    expect(order).toBeDefined();
    expect(order!.id).toBe(createdOrderId);
    expect(order!.status).toBeDefined();
    expect(typeof order!.status).toBe("string");
    expect(order!.status).toBe("pending");
  });

  it("should return 401 for unauthenticated POST /api/orders", async () => {
    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ product_id: testProductId, quantity: 1 }],
        customer_name: "Test User",
        customer_phone: TEST_PHONE,
        delivery_address: "123 Test Street, Baku",
      }),
    });

    expect(res.status).toBe(401);
  });

  it("should return 401 for unauthenticated GET /api/profile/orders", async () => {
    const res = await fetch(`${BASE_URL}/api/profile/orders`);

    expect(res.status).toBe(401);
  });
});
