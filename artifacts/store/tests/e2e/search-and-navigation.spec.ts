import { test, expect } from "@playwright/test";

/**
 * E2E: Search and Navigation
 *
 * Tests search functionality and site navigation:
 * - Search bar finds products
 * - No results state is handled gracefully
 * - Header/footer navigation links work
 * - 404 handling for non-existent pages
 */

test.describe("Search and Navigation", () => {
  test("search returns results for valid query", async ({ page }) => {
    await page.goto("/az");
    await page.waitForLoadState("networkidle");

    // Find and click search button/bar
    const searchBtn = page.locator('[aria-label="Search"]').first();
    if (await searchBtn.isVisible()) {
      await searchBtn.click();
      await page.waitForTimeout(300);
    }

    // Type in search (look for any visible search input)
    const searchInput = page.locator('input[type="search"], input[placeholder*="axtar" i], input[placeholder*="search" i]').first();
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.fill("samsung");
      await page.waitForTimeout(1500); // Wait for search suggestions

      // Should show results or navigate to search page
      const results = page.locator('[class*="suggestion"], [class*="result"], a[href*="search"]');
      const hasResults = await results.first().isVisible({ timeout: 5_000 }).catch(() => false);

      if (!hasResults) {
        // Maybe it navigates on Enter
        await searchInput.press("Enter");
        await page.waitForLoadState("networkidle");
        // Search results page should load
        await expect(page.locator("body")).toContainText(/samsung|nəticə|result/i, { timeout: 5_000 });
      }
    }
  });

  test("search handles empty results gracefully", async ({ page }) => {
    await page.goto("/az/search?q=xyznonexistentproduct123");
    await page.waitForLoadState("networkidle");

    // Should show "no results" state, not an error
    const body = await page.textContent("body");
    expect(body).not.toContain("500");
    expect(body).not.toContain("Internal Server Error");

    // Should show a friendly no-results message
    const noResults = page.locator("text=/tapılmadı|no results|не найден/i");
    await expect(noResults.first()).toBeVisible({ timeout: 5_000 });
  });

  test("non-existent product shows 404 page", async ({ page }) => {
    await page.goto("/az/products/this-product-does-not-exist-xyz");
    await page.waitForLoadState("networkidle");

    // Should show product not found message
    const notFoundText = page.locator("text=/tapılmadı|not found|не найден/i");
    await expect(notFoundText.first()).toBeVisible({ timeout: 10_000 });

    // Should have a link back to products
    const backLink = page.locator("a[href*='/products']");
    await expect(backLink).toBeVisible();
  });

  test("header navigation links are functional", async ({ page }) => {
    await page.goto("/az");
    await page.waitForLoadState("networkidle");

    // Find navigation links in header
    const header = page.locator("header");
    const navLinks = header.locator("a[href*='/az/']");
    const linkCount = await navLinks.count();

    expect(linkCount).toBeGreaterThan(0);

    // Click the first nav link and verify navigation
    if (linkCount > 0) {
      const firstLink = navLinks.first();
      const href = await firstLink.getAttribute("href");
      await firstLink.click();
      await page.waitForLoadState("networkidle");

      // Should have navigated
      if (href) {
        expect(page.url()).toContain(href.split("?")[0]);
      }
    }
  });

  test("footer contains expected links", async ({ page }) => {
    await page.goto("/az");
    await page.waitForLoadState("networkidle");

    // Footer should exist
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();

    // Footer should contain contact or policy links
    const footerLinks = footer.locator("a");
    const count = await footerLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test("CMS page loads correctly", async ({ page }) => {
    // Navigate to a known system page
    await page.goto("/az/page/delivery");
    await page.waitForLoadState("networkidle");

    // Should either show page content or a proper 404 (not a crash)
    const body = await page.textContent("body");
    expect(body).not.toContain("500");
    expect(body).not.toContain("Internal Server Error");
    expect(body?.length).toBeGreaterThan(50); // Has meaningful content
  });
});
