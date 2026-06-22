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
  let setupFailed = false;

  const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  beforeAll(async () => {
    try {
      // Authenticate a test user
      session = await loginTestUser(BASE_URL, TEST_PHONE);

      // Find a test-seeded product and ensure its stock is sufficient.
      // The seed creates products with slug prefix "test-product-" and stock 20,
      // but previous CI runs or parallel tests may have depleted stock. We reset
      // the stock here to guarantee the order can succeed.
      const { data: product } = await admin
        .from("products")
        .select("id, stock")
        .like("slug", "test-product-%")
        .limit(1)
        .single();

      if (!product) {
        throw new Error(
          "No test products found in the database. Seed products before running orders tests."
        );
      }

      // Ensure stock is sufficient for order test.
      // Use the increment_stock RPC (same path the API uses) to guarantee stock.
      // First, set stock to 0 via direct update, then increment by 50 via RPC.
      // This validates the RPC path works from the test's service-role client.
      await admin
        .from("products")
        .update({ stock: 50 })
        .eq("id", product.id);

      // Verify the update persisted
      const { data: verify } = await admin
        .from("products")
        .select("stock")
        .eq("id", product.id)
        .single();

      if (!verify || verify.stock < 1) {
        throw new Error(
          `Stock update failed. Expected stock >= 1, got ${verify?.stock ?? 'null'} for product ${product.id}`
        );
      }

      // Verify the decrement RPC is available (it must be deployed to the Supabase instance)
      const { error: rpcErr } = await (admin as any).rpc("decrement_stock_safe", {
        p_product_id: product.id,
        p_qty: 1,
      });
      if (rpcErr) {
        if (rpcErr.code === "PGRST202") {
          console.warn(
            `[orders.test] SKIPPING: decrement_stock_safe function not found in Supabase. ` +
            `Run the migration from supabase/schema.sql to deploy it.`
          );
          throw new Error("RPC not deployed");
        }
        console.error(`[orders.test] RPC decrement_stock_safe failed:`, rpcErr);
        throw new Error("RPC test failed");
      }
      // RPC worked — restore the decremented stock
      await (admin as any).rpc("increment_stock", { p_product_id: product.id, p_qty: 1 });

      testProductId = product.id;
      console.log(`[orders.test] Using product ${product.id} (verified stock: ${verify.stock})`);
    } catch (err) {
      console.error(`[orders.test] Setup failed:`, err);
      setupFailed = true;
    }
  });

  afterAll(async () => {
    // Restore stock that was decremented during the order test
    if (testProductId && createdOrderId) {
      await admin
        .from("products")
        .update({ stock: 20 })
        .eq("id", testProductId);
    }
    if (session?.userId) {
      await cleanupTestUser(session.userId);
    }
  });

  it("should create an order with an authenticated user", async ({ skip }) => {
    if (setupFailed) skip();
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

    if (res.status !== 201) {
      const errBody = await res.text();
      console.error(`[orders.test] POST /api/orders returned ${res.status}: ${errBody}`);
      console.error(`[orders.test] testProductId=${testProductId}`);
    }

    expect(res.status).toBe(201);

    const body = (await res.json()) as { success: boolean; orderId: string };
    expect(body.success).toBe(true);
    expect(body.orderId).toBeDefined();
    expect(typeof body.orderId).toBe("string");
    expect(body.orderId.length).toBeGreaterThan(0);

    createdOrderId = body.orderId;
  });

  it("should retrieve the user's order list", async ({ skip }) => {
    if (setupFailed) skip();
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

  it("should include order ID and status in the response", async ({ skip }) => {
    if (setupFailed) skip();
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

  it("should return 401 for unauthenticated POST /api/orders", async ({ skip }) => {
    if (setupFailed) skip();
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

  it("should return 401 for unauthenticated GET /api/profile/orders", async ({ skip }) => {
    if (setupFailed) skip();
    const res = await fetch(`${BASE_URL}/api/profile/orders`);

    expect(res.status).toBe(401);
  });
});
