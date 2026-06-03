import { test, expect } from "@playwright/experimental-ct-react";
import ProductCard from "@/components/storefront/ProductCard";
import { CartProvider } from "@/lib/cart/context";

const sampleProduct = {
  slug: "test-product",
  title: "Wireless Headphones",
  price: 49.99,
  originalPrice: 79.99,
  image: null,
  isOnSale: false,
  isDealOfDay: false,
  stock: 10,
  locale: "az",
  rating: 4,
  ratingCount: 12,
  brand: "TechBrand",
  productId: "prod-001",
};

test("displays product name and price", async ({ mount }) => {
  const component = await mount(
    <CartProvider>
      <ProductCard {...sampleProduct} />
    </CartProvider>,
  );

  await expect(component.getByText("Wireless Headphones")).toBeVisible();
  await expect(component.getByText("49.99 AZN")).toBeVisible();
});

test("displays original price with strikethrough when on sale", async ({ mount }) => {
  const component = await mount(
    <CartProvider>
      <ProductCard {...sampleProduct} />
    </CartProvider>,
  );

  const originalPrice = component.getByText("79.99 AZN");
  await expect(originalPrice).toBeVisible();
  await expect(originalPrice).toHaveClass(/line-through/);
});

test("applies Tailwind CSS styles to the card", async ({ mount, page }) => {
  const component = await mount(
    <CartProvider>
      <ProductCard {...sampleProduct} />
    </CartProvider>,
  );

  // The ProductCard root is a wouter Link (renders as <a>) with Tailwind classes
  const card = page.locator(".product-card").first();
  await expect(card).toBeVisible();

  // Verify Tailwind utility classes are applied to the card element
  await expect(card).toHaveClass(/rounded-xl/);
  await expect(card).toHaveClass(/border/);
  await expect(card).toHaveClass(/bg-card/);
  await expect(card).toHaveClass(/overflow-hidden/);

  // Verify the title uses Tailwind typography classes
  const title = component.getByText("Wireless Headphones");
  await expect(title).toHaveClass(/font-medium/);
  await expect(title).toHaveClass(/text-sm/);
  await expect(title).toHaveClass(/line-clamp-2/);

  // Verify the price text has Tailwind color and weight classes
  const priceEl = component.getByText("49.99 AZN");
  await expect(priceEl).toHaveClass(/text-primary/);
  await expect(priceEl).toHaveClass(/font-bold/);
});
