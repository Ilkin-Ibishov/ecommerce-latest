import { expect, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Saved admin session for E2E. `tests/e2e/auth.setup.ts` signs in once per run and writes it
 * here; admin specs load it with `test.use({ storageState: ADMIN_STATE })`. Contains live
 * tokens — the `.auth/` folder is git-ignored.
 */
export const ADMIN_STATE = path.join(import.meta.dirname, "..", "e2e", ".auth", "admin.json");

/**
 * Open /admin and sign in with the test admin phone if the auth gate shows. With a saved
 * session the gate never shows and this only waits for the dashboard, so it stays a safe
 * fallback if the session has expired.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin");

  // Wait for EITHER the auth gate or the dashboard, rather than networkidle (the admin SPA
  // keeps connections open, so networkidle may never fire).
  const authGate = page.getByText("Admin Access Required");
  const dashboard = page.getByRole("heading", { name: "Dashboard" });
  await expect(authGate.or(dashboard).first()).toBeVisible({ timeout: 30000 });

  if (!(await authGate.isVisible().catch(() => false))) return;

  await page.getByRole("button", { name: "Sign In with Phone" }).click();

  // Locale-agnostic selectors: the admin panel renders in its stored locale (defaults to "en"
  // in a fresh browser, e.g. CI), so the LoginModal labels are not Azerbaijani. The phone/OTP
  // inputs use fixed placeholders and each modal step has exactly one submit button.
  const phoneInput = page.getByPlaceholder("+994 XX XXX XX XX");
  await expect(phoneInput).toBeVisible({ timeout: 15000 });
  await phoneInput.fill("+994550000001");
  await page.locator('button[type="submit"]').click();

  const otpInput = page.getByPlaceholder("------");
  await expect(otpInput).toBeVisible({ timeout: 15000 });
  await otpInput.fill("999999");
  await page.locator('button[type="submit"]').click();

  await expect(dashboard).toBeVisible({ timeout: 20000 });
}
