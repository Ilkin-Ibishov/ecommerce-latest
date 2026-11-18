import { test as setup } from "@playwright/test";
import { ADMIN_STATE, STAFF_STATE, loginAsAdmin, loginAsStaff } from "../helpers/admin-auth";

// Runs once before the browser project (see `dependencies` in playwright.config.ts): one OTP
// sign-in per role per run instead of one per test.
setup("sign in as admin", async ({ page }) => {
  await loginAsAdmin(page);
  await page.context().storageState({ path: ADMIN_STATE });
});

setup("sign in as staff", async ({ page }) => {
  await loginAsStaff(page);
  await page.context().storageState({ path: STAFF_STATE });
});
