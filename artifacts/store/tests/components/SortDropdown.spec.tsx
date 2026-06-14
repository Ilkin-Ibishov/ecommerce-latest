import { test, expect } from "@playwright/experimental-ct-react";
import { SortDropdownHarness } from "./harness/SortDropdownHarness";

// az-locale SortDropdown labels (artifacts/store/src/lib/i18n/messages/az.ts).
const LABELS = {
  newest: "Ən yeni",
  priceAsc: "Qiymət: Aşağıdan yuxarı",
  priceDesc: "Qiymət: Yuxarıdan aşağı",
  name: "Ad: A-Z",
};

test("renders the current option label", async ({ mount }) => {
  const component = await mount(<SortDropdownHarness initial="newest" />);

  // The toggle button shows the current option's label.
  await expect(component.getByRole("button", { name: LABELS.newest })).toBeVisible();
});

test("clicking the toggle opens the menu with all four options", async ({ mount }) => {
  const component = await mount(<SortDropdownHarness initial="newest" />);

  // The dropdown menu (w-52 panel) is not present until the toggle is clicked.
  const menu = component.locator("div.w-52");
  await expect(menu).toHaveCount(0);

  await component.getByRole("button", { name: LABELS.newest }).click();

  // All four sort options are shown inside the menu.
  await expect(menu).toHaveCount(1);
  await expect(menu.getByText(LABELS.newest)).toBeVisible();
  await expect(menu.getByText(LABELS.priceAsc)).toBeVisible();
  await expect(menu.getByText(LABELS.priceDesc)).toBeVisible();
  await expect(menu.getByText(LABELS.name)).toBeVisible();
});

test("selecting an option calls onChange with the matching SortOption value", async ({ mount }) => {
  const component = await mount(<SortDropdownHarness initial="newest" />);
  const selected = component.getByTestId("selected");
  await expect(selected).toHaveText("newest");

  // Open and pick "Price: Low to High" → onChange("price_asc").
  await component.getByRole("button", { name: LABELS.newest }).click();
  await component.locator("div.w-52").getByText(LABELS.priceAsc).click();
  await expect(selected).toHaveText("price_asc");

  // Open again (toggle now shows the new current label) and pick "Name" → "name".
  await component.getByRole("button", { name: LABELS.priceAsc }).click();
  await component.locator("div.w-52").getByText(LABELS.name).click();
  await expect(selected).toHaveText("name");
});
