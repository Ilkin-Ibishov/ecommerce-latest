import { test, expect } from "@playwright/test";

/**
 * E2E: Admin Panel
 *
 * Tests the admin panel pages with phone OTP authentication.
 * Covers: Dashboard, Products, Inventory, Orders, Coupons,
 * Categories, Audit Log, Comments, Settings.
 *
 * Note: avoid `waitForLoadState("networkidle")` — the admin SPA keeps
 * connections open (auth/session, polling), so networkidle frequently never
 * fires and the wait burns the full timeout. We rely on web-first assertions
 * (`expect(locator).toBeVisible()`), which auto-wait for the relevant element.
 */

test.describe("Admin Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");

    // Wait for the admin shell to settle into EITHER the auth gate or the
    // dashboard, rather than networkidle.
    const authGate = page.getByText("Admin Access Required");
    const dashboard = page.getByRole("heading", { name: "Dashboard" });
    await expect(authGate.or(dashboard).first()).toBeVisible({ timeout: 30000 });

    const needsAuth = await authGate.isVisible().catch(() => false);
    if (needsAuth) {
      await page.getByRole("button", { name: "Sign In with Phone" }).click();

      // Locale-agnostic selectors: the admin panel renders in its stored locale
      // (defaults to "en" in a fresh browser, e.g. CI), so the LoginModal button
      // labels are NOT Azerbaijani. The phone/OTP inputs use fixed placeholders
      // and each modal step has exactly one `button[type="submit"]`, so we drive
      // the flow by submit button rather than by translated text.
      const phoneInput = page.getByPlaceholder("+994 XX XXX XX XX");
      await expect(phoneInput).toBeVisible({ timeout: 15000 });
      await phoneInput.fill("+994550000001");

      await page.locator('button[type="submit"]').click();

      // Wait for the OTP step to render instead of a fixed timeout.
      const otpInput = page.getByPlaceholder("------");
      await expect(otpInput).toBeVisible({ timeout: 15000 });
      await otpInput.fill("999999");

      await page.locator('button[type="submit"]').click();

      await expect(dashboard).toBeVisible({ timeout: 20000 });
    }
  });

  test.describe("Dashboard", () => {
    test("shows KPI cards with revenue and order data", async ({ page }) => {
      await expect(page.getByText("Revenue")).toBeVisible();
      await expect(page.getByText("Orders")).toBeVisible();
      await expect(page.getByText("Avg Order Value")).toBeVisible();
      await expect(page.getByText("AZN").first()).toBeVisible();
    });

    test("date range selector changes displayed data", async ({ page }) => {
      await page.getByRole("button", { name: "7D" }).click();
      await expect(page.getByText("Revenue — Last 7 days")).toBeVisible({ timeout: 10000 });
    });

    test("low stock alert section is visible", async ({ page }) => {
      const lowStockSection = page.getByText("Low Stock Alert");
      if (await lowStockSection.isVisible().catch(() => false)) {
        await expect(page.getByRole("link", { name: "Manage →" })).toBeVisible();
      }
    });
  });

  test.describe("Products Page", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/admin/products");
      await expect(page.getByRole("heading", { name: "Products" })).toBeVisible({ timeout: 20000 });
    });

    test("displays product list", async ({ page }) => {
      const tableRows = page.locator("table tbody tr");
      await expect(tableRows.first()).toBeVisible({ timeout: 10000 });
    });

    test("search filters products", async ({ page }) => {
      const searchInput = page.getByPlaceholder("Search products…");
      await searchInput.fill("samsung");
      const countText = page.locator("text=/\\d+ product/");
      await expect(countText).toBeVisible({ timeout: 10000 });
    });

    test("sortable columns toggle sort direction", async ({ page }) => {
      await page.locator("th").filter({ hasText: "Price" }).click();
      await expect(page).toHaveURL(/sort=price/, { timeout: 10000 });
    });

    test("bulk selection shows action bar", async ({ page }) => {
      const firstCheckbox = page.locator("table tbody tr input[type=checkbox]").first();
      if (await firstCheckbox.isVisible().catch(() => false)) {
        await firstCheckbox.check();
        await expect(page.getByText("1 selected")).toBeVisible();
        await expect(page.getByText("Bulk Price")).toBeVisible();
      }
    });

    test("category filter is available", async ({ page }) => {
      const categorySelect = page.locator("select").filter({ hasText: "All categories" });
      await expect(categorySelect).toBeVisible();
    });
  });

  test.describe("Inventory Page", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/admin/inventory");
      await expect(page.getByText("Out of Stock")).toBeVisible({ timeout: 20000 });
    });

    test("displays summary cards", async ({ page }) => {
      await expect(page.getByText("Out of Stock")).toBeVisible();
      await expect(page.getByText("Low Stock")).toBeVisible();
      await expect(page.getByText("Healthy Stock")).toBeVisible();
    });

    test("search filters inventory", async ({ page }) => {
      const searchInput = page.getByPlaceholder(/Search by name/i);
      await expect(searchInput).toBeVisible();
      await searchInput.fill("iphone");
      const rows = page.locator("table tbody tr");
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
    });

    test("sortable columns work", async ({ page }) => {
      await page.locator("th").filter({ hasText: "Stock" }).click();
      await expect(page.locator("th").filter({ hasText: "Stock" }).locator("svg")).toBeVisible();
    });

    test("CSV export button exists", async ({ page }) => {
      await expect(page.getByRole("button", { name: /Export CSV/i })).toBeVisible();
    });

    test("inline stock editing", async ({ page }) => {
      const stockCell = page.locator("button[title='Click to edit stock']").first();
      if (await stockCell.isVisible().catch(() => false)) {
        await stockCell.click();
        const input = page.locator("input[type=number]").first();
        await expect(input).toBeVisible();
        await input.press("Escape");
      }
    });
  });

  test.describe("Orders Page", () => {
    test("displays orders list", async ({ page }) => {
      await page.goto("/admin/orders");
      await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible({ timeout: 20000 });
    });
  });

  test.describe("Coupons Page", () => {
    test("displays coupons and new coupon button", async ({ page }) => {
      await page.goto("/admin/coupons");
      await expect(page.getByRole("heading", { name: "Coupons" })).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole("button", { name: /New Coupon/i })).toBeVisible();
    });
  });

  test.describe("Categories Page", () => {
    test("displays categories table", async ({ page }) => {
      await page.goto("/admin/categories");
      await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible({ timeout: 20000 });
      await expect(page.locator("table")).toBeVisible();
    });
  });

  test.describe("Audit Log Page", () => {
    test("displays audit log with filter controls", async ({ page }) => {
      await page.goto("/admin/audit");
      await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible({ timeout: 20000 });
      await expect(page.locator("select").filter({ hasText: "All actions" })).toBeVisible();
      await expect(page.locator("input[type=date]").first()).toBeVisible();
    });
  });

  test.describe("Comments Page", () => {
    test("displays comments sections", async ({ page }) => {
      await page.goto("/admin/comments");
      await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(/Pending Approval/)).toBeVisible();
      await expect(page.getByText(/Approved/)).toBeVisible();
    });
  });

  test.describe("Settings Page", () => {
    test("loads settings page with branding tab", async ({ page }) => {
      await page.goto("/admin/settings");
      await expect(page.getByRole("button", { name: /Branding/i })).toBeVisible({ timeout: 20000 });
    });
  });
});
