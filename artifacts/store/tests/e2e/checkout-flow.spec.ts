import { test, expect } from "@playwright/test";

/**
 * E2E: Checkout Flow
 *
 * Tests the checkout form:
 * - Form validation shows inline errors
 * - Valid form submission flows
 * - Auth requirement before order placement
 * - Coupon code functionality
 */

test.describe("Checkout Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Add a real product to the cart via the storefront's own add-to-cart button, so the
    // checkout page's server-side price/stock check (POST /api/products/prices) finds a real
    // row instead of emptying the cart.
    await page.goto("/az/products");
    await page.waitForLoadState("networkidle");
    const addToCartBtn = page.getByRole("button", { name: "Səbətə əlavə et" }).first();
    await expect(addToCartBtn).toBeVisible({ timeout: 15_000 });
    await addToCartBtn.click();
  });

  test("checkout page shows order summary", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // Should show the checkout heading
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Should show the product from cart
    const orderItem = page.locator("ul li").first();
    await expect(orderItem).toBeVisible({ timeout: 5_000 });

    // Should show the price
    await expect(page.locator("text=AZN").first()).toBeVisible();
  });

  test("form validation shows errors for empty fields", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // Click submit without filling form
    const submitBtn = page.locator('button[type="submit"]').filter({ hasText: "Sifariş" });
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await submitBtn.click();

    // Should show validation error(s)
    // The form uses fieldErrors state to show red text beneath inputs
    const errorMessages = page.locator(".text-destructive, [class*='destructive']");
    await expect(errorMessages.first()).toBeVisible({ timeout: 3_000 });
  });

  test("phone validation rejects invalid format", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // Fill name and address but invalid phone
    const nameInput = page.locator("input").nth(0);
    const phoneInput = page.locator('input[type="tel"]');
    const addressInput = page.locator("input").nth(2);

    await nameInput.fill("Test User");
    await phoneInput.fill("12345"); // invalid phone
    await addressInput.fill("Baku, Test Street");

    // Submit
    const submitBtn = page.locator('button[type="submit"]').filter({ hasText: "Sifariş" });
    await submitBtn.click();

    // Should show phone validation error
    const phoneError = page.locator(".text-destructive, [class*='destructive']");
    await expect(phoneError.first()).toBeVisible({ timeout: 3_000 });
  });

  test("coupon code field shows error for invalid coupon", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // CheckoutPage has no toggle to expand the coupon field — it's always
    // visible directly (see artifacts/store/src/pages/storefront/
    // CheckoutPage.tsx around line 244). A prior version of this test looked
    // for a toggle button first, matching "promo|kupon|code"; on the real
    // page that regex instead matched the (closed, off-screen) cart drawer's
    // own promo toggle, which Playwright reported as "visible" but could
    // never actually scroll into the viewport — timing out the whole test.
    const couponInput = page.locator('input[placeholder*="code" i], input[placeholder*="kod" i]').first();
    await expect(couponInput).toBeVisible({ timeout: 10_000 });

    // Enter invalid coupon code
    await couponInput.fill("INVALID_CODE_XYZ");
    await couponInput.press("Enter");

    // Should show error message for invalid coupon
    const errorText = page.locator(".text-destructive, [class*='destructive']").first();
    await expect(errorText).toBeVisible({ timeout: 5_000 });
  });

  test("checkout requires authentication", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // Fill in valid form data
    const nameInput = page.locator("input").nth(0);
    const phoneInput = page.locator('input[type="tel"]');
    const addressInput = page.locator("input").nth(2);

    await nameInput.fill("Test User");
    await phoneInput.fill("+994501234567");
    await addressInput.fill("Baku, Narimanov, Test Street 12");

    // Submit form
    const submitBtn = page.locator('button[type="submit"]').filter({ hasText: "Sifariş" });
    await submitBtn.click();

    // Should prompt for login (since we're not authenticated)
    // Look for login modal or redirect
    const loginPrompt = page.locator("text=/sign in|daxil|giriş|войти/i").first();
    await expect(loginPrompt).toBeVisible({ timeout: 10_000 });
  });
});
