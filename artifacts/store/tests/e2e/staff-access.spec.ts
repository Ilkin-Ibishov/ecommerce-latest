import { test, expect, type Page } from "@playwright/test";

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

async function loginAsStaff(page: Page): Promise<void> {
  await page.goto("/admin");

  const authGate = page.getByText("Admin Access Required");
  const counterPage = page.locator("main, [role='main']");
  await expect(authGate.or(counterPage).first()).toBeVisible({ timeout: 30000 });

  if (!(await authGate.isVisible().catch(() => false))) return;

  await page.getByRole("button", { name: "Sign In with Phone" }).click();

  const phoneInput = page.getByPlaceholder("+994 XX XXX XX XX");
  await expect(phoneInput).toBeVisible({ timeout: 15000 });
  await phoneInput.fill("+994550000002");
  await page.locator('button[type="submit"]').click();

  const otpInput = page.getByPlaceholder("------");
  await expect(otpInput).toBeVisible({ timeout: 15000 });
  await otpInput.fill("999999");
  await page.locator('button[type="submit"]').click();

  // /admin automatically redirects staff users to /admin/counter
  await expect(page).toHaveURL(/\/admin\/counter/, { timeout: 20000 });
}

test.describe("Staff Access Controls", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
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
    await expect(nav.getByRole("link", { name: /users|istifadəçilər/i })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: /orders|sifarişlər/i })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: /settings|tənzimləmələr/i })).not.toBeVisible();
  });

  test("shows access denied panel when navigating directly to admin-only pages", async ({ page }) => {
    await page.goto("/admin/users");
    // Should display access denied panel rather than the users table
    await expect(page.getByText(/access denied|icazə verilmir|dostup zapreshchen/i)).toBeVisible({ timeout: 10000 });
    await expect(page.locator("table")).not.toBeVisible();
  });
});
