import { test, expect } from '@playwright/test';

test.describe('Super Admin Platform E2E', () => {
  test.skip(!process.env.SUPER_ADMIN_E2E, 'Skipped: set SUPER_ADMIN_E2E=true to run');

  const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://localhost:5173';
  const STORE_URL = process.env.STORE_URL ?? 'http://localhost:5173';

  test('suspend store → 503 notice → reactivate → normal', async ({ page }) => {
    // 1. Navigate to platform dashboard
    await page.goto(`${PLATFORM_URL}/platform`);
    // Verify dashboard loaded (look for the title or a store name)
    await expect(page.locator('h1')).toContainText(/stores|dashboard/i);

    // 2. Find a store and click suspend
    const suspendBtn = page.locator('button:has-text("Suspend")').first();
    if (await suspendBtn.isVisible()) {
      await suspendBtn.click();
      // Wait for status to change
      await page.waitForTimeout(2000);
    }

    // 3. Visit the store's storefront URL — should see 503 notice
    await page.goto(STORE_URL);
    // The suspended notice should be visible
    await expect(page.locator('text=/unavailable|suspended/i')).toBeVisible();

    // 4. Go back to platform and reactivate
    await page.goto(`${PLATFORM_URL}/platform`);
    const reactivateBtn = page.locator('button:has-text("Reactivate")').first();
    if (await reactivateBtn.isVisible()) {
      await reactivateBtn.click();
      await page.waitForTimeout(2000);
    }

    // 5. Visit store again — should work normally
    await page.goto(STORE_URL);
    await expect(page.locator('text=/unavailable|suspended/i')).not.toBeVisible();
  });
});
