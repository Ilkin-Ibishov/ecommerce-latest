import { test, expect } from "@playwright/experimental-ct-react";
import CheckoutPage from "@/pages/storefront/CheckoutPage";
import { CartProvider } from "@/lib/cart/context";
import { Router } from "wouter";

const mockCartItems = [
  {
    product_id: "prod-001",
    slug: "test-wireless-headphones",
    title: "Wireless Headphones",
    price: 49.99,
    image: null,
    quantity: 2,
  },
  {
    product_id: "prod-002",
    slug: "test-usb-cable",
    title: "USB-C Cable",
    price: 9.5,
    image: "https://placeholder.test/cable.jpg",
    quantity: 3,
  },
];

test("line totals and subtotal", async ({ mount, page }) => {
  await page.evaluate((items) => {
    localStorage.setItem("cart_items", JSON.stringify(items));
  }, mockCartItems);

  const component = await mount(
    <CartProvider>
      <Router>
        <CheckoutPage locale="az" />
      </Router>
    </CartProvider>,
  );

  // Wait for the order summary section to render
  await expect(component.getByRole("heading", { name: "Sifariş ver" })).toBeVisible();

  // Assert each item's line total is visible in the order summary
  // Item 1: 49.99 * 2 = 99.98 AZN
  const lineTotal1 = (49.99 * 2).toFixed(2) + " AZN";
  await expect(component.getByText(lineTotal1)).toBeVisible();

  // Item 2: 9.50 * 3 = 28.50 AZN
  const lineTotal2 = (9.5 * 3).toFixed(2) + " AZN";
  await expect(component.getByText(lineTotal2)).toBeVisible();

  // Assert subtotal equals sum of line totals: 99.98 + 28.50 = 128.48 AZN
  // The subtotal is displayed in the "Ara cəm" row
  const expectedSubtotal = (49.99 * 2 + 9.5 * 3).toFixed(2) + " AZN";
  const subtotalRow = component.locator("text=Ara cəm").locator("..");
  await expect(subtotalRow.getByText(expectedSubtotal)).toBeVisible();
});

test("required field validation", async ({ mount, page }) => {
  await page.evaluate((items) => {
    localStorage.setItem("cart_items", JSON.stringify(items));
  }, mockCartItems);

  const component = await mount(
    <CartProvider>
      <Router>
        <CheckoutPage locale="az" />
      </Router>
    </CartProvider>,
  );

  // Wait for checkout form to render
  await expect(component.getByRole("heading", { name: "Sifariş ver" })).toBeVisible();

  // Assert customer_name input has required attribute
  const nameInput = component.locator('input[placeholder="Adınız"]');
  await expect(nameInput).toHaveAttribute("required", "");

  // Assert customer_phone input has required attribute
  const phoneInput = component.locator('input[placeholder="+994 XX XXX XX XX"]');
  await expect(phoneInput).toHaveAttribute("required", "");

  // Assert delivery_address input has required attribute
  const addressInput = component.locator('input[placeholder="Şəhər, küçə, ev nömrəsi"]');
  await expect(addressInput).toHaveAttribute("required", "");

  // Assert notes textarea does NOT have required attribute
  const notesTextarea = component.locator('textarea[placeholder="Kuryer üçün qeyd…"]');
  await expect(notesTextarea).not.toHaveAttribute("required", "");
});

test("fields visible and editable", async ({ mount, page }) => {
  await page.evaluate((items) => {
    localStorage.setItem("cart_items", JSON.stringify(items));
  }, mockCartItems);

  const component = await mount(
    <CartProvider>
      <Router>
        <CheckoutPage locale="az" />
      </Router>
    </CartProvider>,
  );

  // Wait for checkout form to render
  await expect(component.getByRole("heading", { name: "Sifariş ver" })).toBeVisible();

  // Assert name input is visible and fillable
  const nameInput = component.locator('input[placeholder="Adınız"]');
  await expect(nameInput).toBeVisible();
  await nameInput.fill("Test User");
  await expect(nameInput).toHaveValue("Test User");

  // Assert phone input is visible and fillable
  const phoneInput = component.locator('input[placeholder="+994 XX XXX XX XX"]');
  await expect(phoneInput).toBeVisible();
  await phoneInput.fill("+994501234567");
  await expect(phoneInput).toHaveValue("+994501234567");

  // Assert address input is visible and fillable
  const addressInput = component.locator('input[placeholder="Şəhər, küçə, ev nömrəsi"]');
  await expect(addressInput).toBeVisible();
  await addressInput.fill("Baku, Nizami street 42");
  await expect(addressInput).toHaveValue("Baku, Nizami street 42");

  // Assert notes textarea is visible
  const notesTextarea = component.locator('textarea[placeholder="Kuryer üçün qeyd…"]');
  await expect(notesTextarea).toBeVisible();
});
