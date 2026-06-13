import { test, expect } from "@playwright/experimental-ct-react";
import { PriceCell } from "@/components/admin/PriceCell";

/**
 * PriceCell's root element toggles between a <button> (read mode) and an
 * <input> (edit mode). We use `page` locators so selectors stay valid across
 * that root-element switch.
 */

test("displays the formatted price in read mode", async ({ mount }) => {
  const component = await mount(
    <PriceCell productId="p1" initialPrice={49.99} onSaved={() => {}} />
  );
  await expect(component).toContainText("49.99");
});

test("clicking enters edit mode with a number input", async ({ mount, page }) => {
  const component = await mount(
    <PriceCell productId="p1" initialPrice={49.99} onSaved={() => {}} />
  );
  await component.click();
  const input = page.locator("input[type=number]");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("49.99");
});

test("pressing Escape cancels edit and reverts without saving", async ({ mount, page }) => {
  let saved = false;
  const component = await mount(
    <PriceCell productId="p1" initialPrice={49.99} onSaved={() => { saved = true; }} />
  );
  await component.click();
  const input = page.locator("input[type=number]");
  await input.fill("99.99");
  await input.press("Escape");
  await expect(page.getByText("49.99")).toBeVisible();
  expect(saved).toBe(false);
});

test("entering an unchanged price exits without calling onSaved", async ({ mount, page }) => {
  let saved = false;
  const component = await mount(
    <PriceCell productId="p1" initialPrice={49.99} onSaved={() => { saved = true; }} />
  );
  await component.click();
  const input = page.locator("input[type=number]");
  await input.blur();
  await expect(page.getByText("49.99")).toBeVisible();
  expect(saved).toBe(false);
});
