import { test, expect } from "@playwright/test";

/**
 * E2E: Admin Panel
 *
 * Tests the admin panel pages with phone OTP authentication.
 * Covers: Dashboard, Products, Inventory, Orders, Coupons,
 * Categories, Audit Log, Comments, Settings.
 */

test.describe("Admin Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    const needsAuth = await page
      .getByText("Admin Access Required")
      .isVisible()
      .catch(() => false);

    if (needsAuth) {
      await page.getByRole("button", { name: "Sign In with Phone" }).click();
      await page.getByPlaceholder("+994 XX XXX XX XX").fill("+994551234567");
      await page.getByRole("button", { name: /Kod göndər/i }).click();
      await page.waitForTimeout(2000);
      await page.getByPlaceholder("------").fill("999999");
      await page.getByRole("button", { name: /Kodu təsdiqlə/i }).click();
      await page.waitForTimeout(3000);
      await expect(
        page.getByRole("heading", { name: "Dashboard" })
      ).toBeVisible({ timeout: 15000 });
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
      await page.waitForTimeout(1500);
      await expect(page.getByText("Revenue — Last 7 days")).toBeVisible();
    });

    test("low stock alert section is visible", async ({ page }) => {
      const lowStockSection = page.getByText("Low Stock Alert");
      if (await lowStockSection.isVisible()) {
        await expect(page.getByRole("link", { name: "Manage →" })).toBeVisible();
      }
    });
  });

  test.describe("Products Page", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/admin/products");
      await page.waitForLoadState("networkidle");
    });

    test("displays product list", async ({ page }) => {
      await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
      const tableRows = page.locator("table tbody tr");
      await expect(tableRows.first()).toBeVisible({ timeout: 10000 });
    });

    test("search filters products", async ({ page }) => {
      const searchInput = page.getByPlaceholder("Search products…");
      await searchInput.fill("samsung");
      await page.waitForTimeout(500);
      await page.waitForLoadState("networkidle");
      const countText = page.locator("text=/\\d+ product/");
      await expect(countText).toBeVisible();
    });

    test("sortable columns toggle sort direction", async ({ page }) => {
      await page.locator("th").filter({ hasText: "Price" }).click();
      await page.waitForTimeout(500);
      expect(page.url()).toContain("sort=price");
    });

    test("bulk selection shows action bar", async ({ page }) => {
      const firstCheckbox = page.locator("table tbody tr input[type=checkbox]").first();
      if (await firstCheckbox.isVisible()) {
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
      await page.waitForLoadState("networkidle");
    });

    test("displays summary cards", async ({ page }) => {
      await expect(page.getByText("Out of Stock")).toBeVisible({ timeout: 10000 });
      await expect(page.getByText("Low Stock")).toBeVisible();
      await expect(page.getByText("Healthy Stock")).toBeVisible();
    });

    test("search filters inventory", async ({ page }) => {
      const searchInput = page.getByPlaceholder(/Search by name/i);
      await expect(searchInput).toBeVisible();
      await searchInput.fill("iphone");
      await page.waitForTimeout(400);
      const rows = page.locator("table tbody tr");
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
    });

    test("sortable columns work", async ({ page }) => {
      await page.locator("th").filter({ hasText: "Stock" }).click();
      await page.waitForTimeout(300);
      await expect(page.locator("th").filter({ hasText: "Stock" }).locator("svg")).toBeVisible();
    });

    test("CSV export button exists", async ({ page }) => {
      await expect(page.getByRole("button", { name: /Export CSV/i })).toBeVisible();
    });

    test("inline stock editing", async ({ page }) => {
      const stockCell = page.locator("button[title='Click to edit stock']").first();
      if (await stockCell.isVisible()) {
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
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    });
  });

  test.describe("Coupons Page", () => {
    test("displays coupons and new coupon button", async ({ page }) => {
      await page.goto("/admin/coupons");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: "Coupons" })).toBeVisible();
      await expect(page.getByRole("button", { name: /New Coupon/i })).toBeVisible();
    });
  });

  test.describe("Categories Page", () => {
    test("displays categories table", async ({ page }) => {
      await page.goto("/admin/categories");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
      await expect(page.locator("table")).toBeVisible();
    });
  });

  test.describe("Audit Log Page", () => {
    test("displays audit log with filter controls", async ({ page }) => {
      await page.goto("/admin/audit");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
      await expect(page.locator("select").filter({ hasText: "All actions" })).toBeVisible();
      await expect(page.locator("input[type=date]").first()).toBeVisible();
    });
  });

  test.describe("Comments Page", () => {
    test("displays comments sections", async ({ page }) => {
      await page.goto("/admin/comments");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
      await expect(page.getByText(/Pending Approval/)).toBeVisible();
      await expect(page.getByText(/Approved/)).toBeVisible();
    });
  });

  test.describe("Settings Page", () => {
    test("loads settings page with branding tab", async ({ page }) => {
      await page.goto("/admin/settings");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("button", { name: /Branding/i })).toBeVisible();
    });
  });
});
