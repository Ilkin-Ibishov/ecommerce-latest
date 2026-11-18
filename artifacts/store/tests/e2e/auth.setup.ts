import { test as setup } from "@playwright/test";
import { ADMIN_STATE, loginAsAdmin } from "../helpers/admin-auth";

// Runs once before the browser project (see `dependencies` in playwright.config.ts): one OTP
// sign-in per run instead of one per admin test.
setup("sign in as admin", async ({ page }) => {
  await loginAsAdmin(page);
  await page.context().storageState({ path: ADMIN_STATE });
});
