import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createStockedVariant } from "../../../api-server/tests/helpers/stocked-variant";

/**
 * Counter screen E2E test at phone and desktop width with a keyboard-wedge scanner.
 * Runs in CI `integration-e2e` (Playwright E2E step).
 */
function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL environment variable is missing");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loginAsAdmin(page: Page) {
  await page.goto("/admin");
  const authGate = page.getByText("Admin Access Required");
  const dashboard = page.getByRole("heading", { name: "Dashboard" });
  await expect(authGate.or(dashboard).first()).toBeVisible({ timeout: 30000 });

  const needsAuth = await authGate.isVisible().catch(() => false);
  if (needsAuth) {
    await page.getByRole("button", { name: "Sign In with Phone" }).click();
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
}

async function createVariantWithBarcode(db: SupabaseClient, actor: string) {
  const variantId = await createStockedVariant(db, actor, 5, 4);
  const barcode = "299" + Date.now() + Math.floor(Math.random() * 1000);
  const { error } = await db.from("variant_barcodes").insert({
    variant_id: variantId,
    barcode,
    source: "internal",
  });
  if (error) throw new Error(`variant_barcodes insert: ${error.message}`);
  return { variantId, barcode };
}

async function runCounterSaleFlow(page: Page, db: SupabaseClient, variantId: string, barcode: string, isPhone = false) {
  await page.goto("/admin/counter");
  await expect(page.getByRole("heading", { name: "Kassa" })).toBeVisible({ timeout: 20000 });

  // Scan without clicking the input: prove initial focus
  await page.keyboard.type(barcode);
  await page.keyboard.press("Enter");

  // Wait for the cart line to appear
  const cartLines = page.locator("ul.divide-y li");
  await expect(cartLines.first()).toBeVisible({ timeout: 10000 });

  // Scan again: prove focus returned after lookup
  await page.keyboard.type(barcode);
  await page.keyboard.press("Enter");

  // Expect one cart line with quantity 2 and total 8.00 AZN
  await expect(cartLines).toHaveCount(1);
  await expect(cartLines.first().getByText("2")).toBeVisible();
  await expect(page.getByText("8.00 AZN")).toBeVisible();

  // Payment method selection
  await page.getByRole("radio", { name: "Nağd" }).click();

  if (isPhone) {
    const noSidewaysScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noSidewaysScroll).toBe(true);
  }

  await page.getByRole("button", { name: "Tamamla" }).click();

  // Status message
  await expect(page.getByRole("status")).toHaveText(/Satış #\d+ tamamlandı\./, { timeout: 10000 });

  // Verify DB with service client
  const { data: lineRows } = await db.from("counter_sale_lines").select("sale_id").eq("variant_id", variantId);
  const saleIds = (lineRows ?? []).map((l) => l.sale_id);
  const { data: saleRow, error: saleErr } = await db
    .from("counter_sales")
    .select("status, total_amount")
    .in("id", saleIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  expect(saleErr).toBeNull();
  expect(saleRow).toMatchObject({ status: "posted", total_amount: 8 });

  const { data: varRow } = await db.from("product_variants").select("on_hand").eq("id", variantId).single();
  expect(Number(varRow?.on_hand)).toBe(3);

  // Click Qəbz and verify receipt page shows 8.00
  await page.getByRole("link", { name: "Qəbz" }).click();
  await expect(page.locator("#receipt")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#receipt")).toContainText("8.00");
}

test.describe("Counter Screen E2E", () => {
  let db: SupabaseClient;
  let actor: string;

  test.beforeAll(async () => {
    db = getServiceClient();
    const { data: user, error: userErr } = await db
      .from("users")
      .select("id")
      .eq("phone", "+994550000001")
      .single();
    if (userErr || !user) throw new Error(`admin user lookup: ${userErr?.message}`);
    actor = user.id;
  });

  test.describe("Desktop Viewport", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("completes counter sale with wedge scanner at desktop width", async ({ page }) => {
      await loginAsAdmin(page);
      const { variantId, barcode } = await createVariantWithBarcode(db, actor);
      await runCounterSaleFlow(page, db, variantId, barcode, false);
    });
  });

  test.describe("Phone Viewport", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("completes counter sale with wedge scanner at phone width without sideways scroll", async ({ page }) => {
      await loginAsAdmin(page);
      const { variantId, barcode } = await createVariantWithBarcode(db, actor);
      await runCounterSaleFlow(page, db, variantId, barcode, true);
    });
  });
});
