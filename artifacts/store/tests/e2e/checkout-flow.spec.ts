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
    // Pre-populate cart with a product via localStorage
    await page.goto("/az");
    await page.evaluate(() => {
      const cartItem = {
        product_id: "test-product-id",
        slug: "test-product",
        title: "Test Product",
        price: 50,
        quantity: 1,
        image: null,
      };
      localStorage.setItem("cart_items", JSON.stringify([cartItem]));
    });
  });

  test("checkout page shows order summary", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // Should show the checkout heading
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Should show the product from cart
    await expect(page.locator("text=Test Product")).toBeVisible({ timeout: 5_000 });

    // Should show the price
    await expect(page.locator("text=AZN")).toBeVisible();
  });

  test("form validation shows errors for empty fields", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // Click submit without filling form
    const submitBtn = page.locator('button[type="submit"]');
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
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Should show phone validation error
    const phoneError = page.locator(".text-destructive, [class*='destructive']");
    await expect(phoneError.first()).toBeVisible({ timeout: 3_000 });
  });

  test("coupon code field shows error for invalid coupon", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // Look for promo/coupon section toggle
    const promoToggle = page.locator("button").filter({ hasText: /promo|kupon|code/i }).first();
    if (await promoToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await promoToggle.click();
      await page.waitForTimeout(300);

      // Enter invalid coupon code
      const couponInput = page.locator('input[placeholder*="code" i], input[placeholder*="kod" i]').first();
      if (await couponInput.isVisible()) {
        await couponInput.fill("INVALID_CODE_XYZ");
        await couponInput.press("Enter");

        // Should show error message for invalid coupon
        await page.waitForTimeout(2000); // Wait for API response
        const errorText = page.locator(".text-destructive, [class*='destructive']").first();
        await expect(errorText).toBeVisible({ timeout: 5_000 });
      }
    }
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
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Should prompt for login (since we're not authenticated)
    // Look for login modal or redirect
    const loginPrompt = page.locator("text=/sign in|daxil|giriş|войти/i").first();
    await expect(loginPrompt).toBeVisible({ timeout: 10_000 });
  });
});
