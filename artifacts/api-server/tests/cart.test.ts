import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loginTestUser } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const TEST_PHONE = "+994501234002";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

describe("Cart Integration Tests", () => {
  let userId: string;
  let accessToken: string;
  let testProductId: string;
  let cartItemId: string;
  const testSessionId = `test-session-cart-${Date.now()}`;

  beforeAll(async () => {
    // Authenticate a test user
    const session = await loginTestUser(BASE_URL, TEST_PHONE);
    userId = session.userId;
    accessToken = session.accessToken;

    // Get a product from the database to use in cart tests
    const { data: products } = await admin
      .from("products")
      .select("id")
      .limit(1)
      .single();

    if (!products) {
      throw new Error("No products found in database. Seed data is required for cart tests.");
    }

    testProductId = products.id;
  });

  afterAll(async () => {
    if (userId) {
      await cleanupTestUser(userId);
    }
    // Clean up any guest cart items from the test session
    await admin
      .from("cart_items")
      .delete()
      .eq("session_id", testSessionId);
  });

  it("should add a product to cart via merge endpoint", async () => {
    // Insert a guest cart item with the test session ID
    const { error: insertError } = await admin
      .from("cart_items")
      .insert({
        session_id: testSessionId,
        product_id: testProductId,
        quantity: 2,
      });

    expect(insertError).toBeNull();

    // Merge the guest session into the authenticated user's cart
    const res = await fetch(`${BASE_URL}/api/cart/merge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ session_id: testSessionId }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { merged: number };
    expect(body.merged).toBe(1);

    // Verify the item is now in the user's cart
    const cartRes = await fetch(`${BASE_URL}/api/cart`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(cartRes.status).toBe(200);

    const cartItems = (await cartRes.json()) as Array<{
      id: string;
      quantity: number;
      products: { id: string };
    }>;

    const addedItem = cartItems.find(
      (item) => item.products?.id === testProductId
    );
    expect(addedItem).toBeDefined();
    expect(addedItem!.quantity).toBe(2);

    // Store the cart item ID for subsequent tests
    cartItemId = addedItem!.id;
  });

  it("should update cart item quantity", async () => {
    // Update quantity directly via admin client (no dedicated API endpoint)
    const { error: updateError } = await admin
      .from("cart_items")
      .update({ quantity: 5 })
      .eq("id", cartItemId);

    expect(updateError).toBeNull();

    // Verify updated state via GET /api/cart
    const res = await fetch(`${BASE_URL}/api/cart`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(200);

    const cartItems = (await res.json()) as Array<{
      id: string;
      quantity: number;
      products: { id: string };
    }>;

    const updatedItem = cartItems.find((item) => item.id === cartItemId);
    expect(updatedItem).toBeDefined();
    expect(updatedItem!.quantity).toBe(5);
  });

  it("should remove item from cart", async () => {
    // Remove the cart item directly via admin client (no dedicated API endpoint)
    const { error: deleteError } = await admin
      .from("cart_items")
      .delete()
      .eq("id", cartItemId);

    expect(deleteError).toBeNull();

    // Verify the item is no longer in the cart
    const res = await fetch(`${BASE_URL}/api/cart`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(200);

    const cartItems = (await res.json()) as Array<{
      id: string;
      quantity: number;
      products: { id: string };
    }>;

    const removedItem = cartItems.find((item) => item.id === cartItemId);
    expect(removedItem).toBeUndefined();
  });

  it("should return updated cart state in response after merge", async () => {
    // Insert another guest cart item
    const newSessionId = `test-session-cart-state-${Date.now()}`;

    const { error: insertError } = await admin
      .from("cart_items")
      .insert({
        session_id: newSessionId,
        product_id: testProductId,
        quantity: 3,
      });

    expect(insertError).toBeNull();

    // Merge and verify the response confirms the merge count
    const mergeRes = await fetch(`${BASE_URL}/api/cart/merge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ session_id: newSessionId }),
    });

    expect(mergeRes.status).toBe(200);

    const mergeBody = (await mergeRes.json()) as { merged: number };
    expect(mergeBody.merged).toBe(1);

    // Confirm the cart now reflects the merged item
    const cartRes = await fetch(`${BASE_URL}/api/cart`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(cartRes.status).toBe(200);

    const cartItems = (await cartRes.json()) as Array<{
      id: string;
      quantity: number;
      products: { id: string };
    }>;

    const mergedItem = cartItems.find(
      (item) => item.products?.id === testProductId
    );
    expect(mergedItem).toBeDefined();
    expect(mergedItem!.quantity).toBeGreaterThan(0);
  });

  it("should return 401 for unauthenticated cart request", async () => {
    const res = await fetch(`${BASE_URL}/api/cart`);

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it("should return 401 for unauthenticated cart merge request", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "some-session" }),
    });

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });
});
