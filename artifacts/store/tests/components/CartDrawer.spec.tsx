import { test, expect } from "@playwright/experimental-ct-react";
import CartDrawer from "@/components/storefront/CartDrawer";
import { CartProvider } from "@/lib/cart/context";
import { Router } from "wouter";

const mockItems = [
  {
    product_id: "prod-001",
    slug: "test-headphones",
    title: "Wireless Headphones",
    price: 49.99,
    image: null,
    quantity: 2,
  },
  {
    product_id: "prod-002",
    slug: "test-speaker",
    title: "Bluetooth Speaker",
    price: 29.5,
    image: null,
    quantity: 1,
  },
];

test("renders items with title, quantity, price", async ({ mount, page }) => {
  await page.evaluate((items) => {
    localStorage.setItem("cart_items", JSON.stringify(items));
  }, mockItems);

  const component = await mount(
    <CartProvider>
      <Router>
        <CartDrawer open={true} onClose={() => {}} locale="az" />
      </Router>
    </CartProvider>,
  );

  // Assert each item title is visible
  await expect(component.getByText("Wireless Headphones")).toBeVisible();
  await expect(component.getByText("Bluetooth Speaker")).toBeVisible();

  // Assert quantities are visible
  await expect(component.getByText("2", { exact: true })).toBeVisible();
  await expect(component.getByText("1", { exact: true })).toBeVisible();

  // Assert unit prices formatted as "X.XX AZN"
  await expect(component.getByText("49.99 AZN").first()).toBeVisible();
  await expect(component.getByText("29.50 AZN").first()).toBeVisible();
});

test("remove item", async ({ mount, page }) => {
  await page.evaluate((items) => {
    localStorage.setItem("cart_items", JSON.stringify(items));
  }, mockItems);

  const component = await mount(
    <CartProvider>
      <Router>
        <CartDrawer open={true} onClose={() => {}} locale="az" />
      </Router>
    </CartProvider>,
  );

  // Wait for items to render
  await expect(component.getByText("Wireless Headphones")).toBeVisible();

  // Click the Trash2 icon button for the first item
  const firstItem = component.locator("li").first();
  await firstItem.locator("button:has(svg)").filter({ has: page.locator("svg") }).last().click();

  // Assert the first item's title is no longer in the DOM
  await expect(component.getByText("Wireless Headphones")).not.toBeVisible();
});

test("empty state", async ({ mount, page }) => {
  // Ensure localStorage has no cart items
  await page.evaluate(() => {
    localStorage.removeItem("cart_items");
  });

  const component = await mount(
    <CartProvider>
      <Router>
        <CartDrawer open={true} onClose={() => {}} locale="az" />
      </Router>
    </CartProvider>,
  );

  await expect(component.getByText("Səbətiniz boşdur")).toBeVisible();
});

test("increment quantity", async ({ mount, page }) => {
  await page.evaluate((items) => {
    localStorage.setItem("cart_items", JSON.stringify(items));
  }, mockItems);

  const component = await mount(
    <CartProvider>
      <Router>
        <CartDrawer open={true} onClose={() => {}} locale="az" />
      </Router>
    </CartProvider>,
  );

  // Wait for items to render
  await expect(component.getByText("Wireless Headphones")).toBeVisible();

  // The first item has quantity 2. Click the Plus icon to increment.
  const firstItem = component.locator("li").first();
  // The Plus button is the second button in the quantity control group (Minus, then Plus)
  const plusButton = firstItem.locator("button:has(svg)").nth(1);
  await plusButton.click();

  // Assert quantity increased from 2 to 3
  await expect(firstItem.getByText("3", { exact: true })).toBeVisible();
});
