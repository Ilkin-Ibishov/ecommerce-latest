import { test, expect } from "@playwright/test";

/**
 * E2E Happy-Path Purchase Flow
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 *
 * Assumes:
 * - Seed data is populated (products with `test-` slug prefix exist)
 * - API server is running on localhost:5000 (or proxied)
 * - Store dev server is running on localhost:3000
 */

const API_BASE = "http://localhost:5000/api";

/**
 * Authenticate a test user via the dev mock-OTP flow.
 * Uses the /api/dev/mock-otp endpoint to generate a code, then verifies it
 * through the standard /api/auth/otp/verify endpoint to get a valid session.
 * Returns the access token and sets it in the browser's Supabase local storage.
 */
async function authenticateTestUser(
  page: import("@playwright/test").Page,
  phone: string,
): Promise<string> {
  // Step 1: Request mock OTP via dev endpoint
  const mockRes = await page.request.post(`${API_BASE}/dev/mock-otp`, {
    data: { phone },
  });
  expect(mockRes.ok(), `Mock OTP request failed: ${mockRes.status()}`).toBe(true);
  const { code } = await mockRes.json();

  // Step 2: Request OTP through normal flow (registers the phone in auth system)
  const requestRes = await page.request.post(`${API_BASE}/auth/otp/request`, {
    data: { phone },
  });
  expect(requestRes.ok(), `OTP request failed: ${requestRes.status()}`).toBe(true);

  // Step 3: Verify OTP to get session tokens
  const verifyRes = await page.request.post(`${API_BASE}/auth/otp/verify`, {
    data: { phone, code },
  });
  expect(verifyRes.ok(), `OTP verify failed: ${verifyRes.status()}`).toBe(true);
  const verifyData = await verifyRes.json();
  const accessToken = verifyData.access_token;

  // Step 4: Inject Supabase session into browser localStorage
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const storageKey = supabaseUrl
    ? `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
    : "sb-auth-token";

  await page.evaluate(
    ({ key, session }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          expires_in: session.expires_in,
          token_type: "bearer",
          user: session.user,
        }),
      );
    },
    { key: storageKey, session: verifyData },
  );

  return accessToken;
}

/**
 * Generate a unique test phone number to avoid collisions.
 * Uses the Azerbaijani format: +99450XXXXXXX
 */
function generateTestPhone(): string {
  const workerPart = String(process.pid % 1000).padStart(3, "0");
  const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `+99450${workerPart}${randomPart}`;
}

test.describe("E2E Purchase Flow", () => {
  // Set test timeout to 60 seconds (Requirement 7.8)
  test.describe.configure({ timeout: 60_000 });

  test("complete purchase flow", async ({ page }) => {
    const testPhone = generateTestPhone();

    // Step 1: Navigate to products page
    await page.goto("/az/products");

    // Step 2: Assert at least one product is visible within 10 seconds (Requirement 7.2)
    const productCards = page.locator(".product-card");
    await expect(productCards.first()).toBeVisible({ timeout: 10_000 });

    // Step 3: Click add-to-cart on the first product (Requirement 7.3)
    // The add-to-cart button has aria-label "Səbətə əlavə et"
    // We need to hover over the product card first to reveal the button
    const firstProduct = productCards.first();
    await firstProduct.hover();
    const addToCartBtn = firstProduct.locator('button[aria-label="Səbətə əlavə et"]');
    await expect(addToCartBtn).toBeVisible({ timeout: 5_000 });
    await addToCartBtn.click();

    // Step 4: Assert cart badge shows "1" (Requirement 7.3)
    // The cart badge is inside the button with aria-label "Cart" in the header
    const cartButton = page.locator('header button[aria-label="Cart"]');
    const cartBadge = cartButton.locator("span");
    await expect(cartBadge).toHaveText("1", { timeout: 5_000 });

    // Step 5: Authenticate test user before navigating to checkout (Requirement 7.7)
    // Navigate to a page first to have access to localStorage, then inject session
    await authenticateTestUser(page, testPhone);

    // Step 6: Navigate to checkout (Requirement 7.4)
    await page.goto("/az/checkout");

    // Wait for the checkout form to be visible
    await expect(page.locator("h1")).toContainText("Sifariş ver", { timeout: 10_000 });

    // Step 7: Fill in customer details (Requirement 7.4)
    // customer_name: max 100 chars
    await page.locator('input[placeholder="Adınız"]').fill("Test Customer Name");

    // customer_phone: valid format
    await page.locator('input[placeholder="+994 XX XXX XX XX"]').fill(testPhone);

    // delivery_address: max 250 chars
    await page.locator('input[placeholder="Şəhər, küçə, ev nömrəsi"]').fill(
      "Bakı, Nərimanov rayonu, Atatürk prospekti 12",
    );

    // Step 8: Submit the order (Requirement 7.5)
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Step 9: Assert order confirmation view (Requirement 7.5)
    // The confirmation shows "Sifariş qəbul edildi!" heading and an order ID
    await expect(page.locator("h1")).toContainText("Sifariş qəbul edildi!", {
      timeout: 15_000,
    });

    // Assert order ID is visible (displayed as "#XXXXXXXX" format)
    const orderIdText = page.locator("text=Sifariş ID:");
    await expect(orderIdText).toBeVisible({ timeout: 5_000 });
  });
});
