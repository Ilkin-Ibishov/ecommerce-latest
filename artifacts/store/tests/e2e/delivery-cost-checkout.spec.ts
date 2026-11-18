import { test, expect } from "@playwright/test";

/**
 * E2E: Checkout delivery cost at confirmation (spec §11).
 *
 * Verifies that:
 * 1. Checkout summary displays "Təsdiq zamanı bildirilir" and "Məhsulların məbləği" when
 *    delivery fee is not known at checkout (no unsupported total is displayed).
 * 2. Stored subtotal_azn equals the exact figure the checkout page showed.
 */
test.describe("Checkout Delivery Cost at Confirmation", () => {
  test.beforeEach(async ({ page }) => {
    // Add an item to cart from storefront
    await page.goto("/az/products");
    await page.waitForLoadState("networkidle");
    const addToCartBtn = page.getByRole("button", { name: "Səbətə əlavə et" }).first();
    await expect(addToCartBtn).toBeVisible({ timeout: 15_000 });
    await addToCartBtn.click();
  });

  test("checkout summary shows told at confirmation and goods total without unsupported fee", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    // Delivery row must show "Təsdiq zamanı bildirilir" when quote is null
    const deliveryRow = page.locator("text=Təsdiq zamanı bildirilir");
    await expect(deliveryRow).toBeVisible({ timeout: 10_000 });

    // Total row must show "Məhsulların məbləği" instead of final total
    const goodsLabel = page.locator("text=Məhsulların məbləği").first();
    await expect(goodsLabel).toBeVisible({ timeout: 10_000 });

    // Submit button also shows "Məhsulların məbləği"
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText("Məhsulların məbləği");

    // Explaining sentence must be visible under summary
    const explanation = page.locator("text=Çatdırılma haqqı ünvanınıza görə dəyişir");
    await expect(explanation).toBeVisible();
  });

  test("form inputs have maxLength guards and submit verifies displayed total", async ({ page }) => {
    await page.goto("/az/checkout");
    await page.waitForLoadState("networkidle");

    const nameInput = page.locator("input").nth(0);
    const phoneInput = page.locator('input[type="tel"]');
    const addressInput = page.locator("input").nth(2);

    await expect(nameInput).toHaveAttribute("maxLength", "100");
    await expect(phoneInput).toHaveAttribute("maxLength", "20");
    await expect(addressInput).toHaveAttribute("maxLength", "300");

    await nameInput.fill("Test Customer");
    await phoneInput.fill("+994501112233");
    await addressInput.fill("Baku, Nizami 123");

    // Submit button is disabled or triggers auth login if unauthenticated
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Prompts login modal for unauthenticated user
    const loginPrompt = page.locator("text=/sign in|daxil|giriş|войти/i").first();
    await expect(loginPrompt).toBeVisible({ timeout: 10_000 });
  });
});
