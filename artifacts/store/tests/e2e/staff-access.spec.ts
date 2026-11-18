import { test, expect } from "@playwright/test";
import { STAFF_STATE } from "../helpers/admin-auth";

/**
 * E2E: Staff Access and Permission Boundaries
 *
 * Verifies that a staff user (+994550000002 bypass phone):
 * - Signs in via phone OTP
 * - Lands on /admin/counter when visiting /admin
 * - Sees only staff-permitted navigation items (counter, inventory)
 * - Cannot see admin-only navigation items (Users, Orders, Settings)
 * - Is blocked by the access guard when attempting to reach admin-only routes directly
 */

// The staff session saved by auth.setup.ts: one OTP sign-in per run, not one per test (parallel
// sign-ins of the same phone were flaky).
test.use({ storageState: STAFF_STATE });

test.describe("Staff Access Controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/counter");
    await expect(page.locator("nav").getByRole("link", { name: /counter/i })).toBeVisible({ timeout: 30000 });
  });

  test("/admin lands on the counter page", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/counter/, { timeout: 10000 });
  });

  test("shows counter and inventory entries in sidebar", async ({ page }) => {
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: /counter|kassa/i })).toBeVisible({ timeout: 10000 });
    await expect(nav.getByRole("link", { name: /inventory|anbar/i })).toBeVisible({ timeout: 10000 });
  });

  test("does not show Users, Orders, or Settings in navigation", async ({ page }) => {
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: /customers|users/i })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: /orders|sifarişlər/i })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: /settings|tənzimləmələr/i })).not.toBeVisible();
  });

  test("shows access denied panel when navigating directly to admin-only pages", async ({ page }) => {
    await page.goto("/admin/users");
    // Should display access denied panel rather than the users table
    await expect(page.getByText("This section is for administrators only")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("table")).not.toBeVisible();
  });
});
