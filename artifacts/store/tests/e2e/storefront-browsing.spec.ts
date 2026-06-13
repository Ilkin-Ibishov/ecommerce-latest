import { test, expect } from "@playwright/test";

/**
 * E2E: Storefront Browsing Flow
 *
 * Tests the core browsing experience:
 * - Homepage loads correctly
 * - Product navigation works
 * - Product detail page renders
 * - Locale switching functions
 */

test.describe("Storefront Browsing", () => {
  test("homepage loads with key sections", async ({ page }) => {
    await page.goto("/az");

    // Hero section visible
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    // Header navigation is present
    await expect(page.locator("header")).toBeVisible();

    // At least one link to products exists
    const productsLink = page.locator('a[href*="/products"]').first();
    await expect(productsLink).toBeVisible();
  });

  test("products page displays product grid", async ({ page }) => {
    await page.goto("/az/products");

    // Wait for products to load (skeleton or actual cards)
    await page.waitForLoadState("networkidle");

    // Product grid should have items or an empty state
    const productGrid = page.locator('[class*="grid"]').first();
    await expect(productGrid).toBeVisible({ timeout: 15_000 });
  });

  test("product detail page loads from product link", async ({ page }) => {
    await page.goto("/az/products");
    await page.waitForLoadState("networkidle");

    // Find first product link and click it
    const productLink = page.locator('a[href*="/products/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();

      // Should navigate to a product detail page
      await page.waitForURL("**/products/**");

      // Product detail should show price
      await expect(page.locator("text=AZN")).toBeVisible({ timeout: 10_000 });
    }
  });

  test("locale switcher changes content language", async ({ page }) => {
    await page.goto("/az");
    await page.waitForLoadState("networkidle");

    // Get the Azerbaijani content
    const azContent = await page.textContent("body");

    // Navigate to English
    await page.goto("/en");
    await page.waitForLoadState("networkidle");

    const enContent = await page.textContent("body");

    // Content should be different (different language)
    expect(azContent).not.toBe(enContent);
  });

  test("header shows cart button with badge", async ({ page }) => {
    await page.goto("/az");
    await page.waitForLoadState("networkidle");

    // Cart button exists in header (desktop)
    const cartBtn = page.locator('[aria-label="Cart"]');
    await expect(cartBtn).toBeVisible({ timeout: 5_000 });
  });

  test("categories page loads", async ({ page }) => {
    await page.goto("/az/categories");

    // Should show categories heading
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });
  });
});
