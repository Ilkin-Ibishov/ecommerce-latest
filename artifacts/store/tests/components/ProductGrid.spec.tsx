import { test, expect } from "@playwright/experimental-ct-react";
import { Router } from "wouter";
import { ProductGrid, type ProductCardData } from "@/components/storefront/ProductGrid";
import { CartProvider } from "@/lib/cart/context";
import { I18nProvider } from "@/lib/i18n/context";

// ProductGrid renders ProductCard, which uses useCart()/useI18n() and a wouter
// <Link>. We supply those providers inline (mirroring ProductCard.spec.tsx /
// Header.spec.tsx). ProductGrid's props are plain/serializable, so no render-
// function harness is needed here.

const products: ProductCardData[] = [
  { id: "p1", slug: "alpha", title: "Alpha Product", price: 10 },
  { id: "p2", slug: "bravo", title: "Bravo Product", price: 20 },
  { id: "p3", slug: "charlie", title: "Charlie Product", price: 30 },
];

function wrap(node: React.ReactNode) {
  return (
    <CartProvider>
      <Router>
        <I18nProvider locale="az">{node}</I18nProvider>
      </Router>
    </CartProvider>
  );
}

test("renders the skeleton grid and no product cards while loading", async ({ mount }) => {
  const component = await mount(
    wrap(<ProductGrid products={products} loading={true} locale="az" />),
  );

  // ProductSkeletonGrid renders shimmer placeholders (default count = 8). These
  // are empty layout divs, so we assert they're present in the DOM rather than
  // visually painted.
  await expect(component.locator(".shimmer").first()).toBeAttached();
  expect(await component.locator(".shimmer").count()).toBeGreaterThan(0);
  // No real product cards while loading.
  await expect(component.locator(".product-card")).toHaveCount(0);
  await expect(component.getByText("Alpha Product")).toHaveCount(0);
});

test("renders one ProductCard per product when not loading", async ({ mount }) => {
  const component = await mount(
    wrap(<ProductGrid products={products} loading={false} locale="az" />),
  );

  // One card per product, no skeletons.
  await expect(component.locator(".product-card")).toHaveCount(3);
  await expect(component.locator(".shimmer")).toHaveCount(0);

  // Each product title is visible.
  await expect(component.getByText("Alpha Product")).toBeVisible();
  await expect(component.getByText("Bravo Product")).toBeVisible();
  await expect(component.getByText("Charlie Product")).toBeVisible();
});

test("renders no cards and no skeletons for an empty product list", async ({ mount }) => {
  const component = await mount(
    wrap(<ProductGrid products={[]} loading={false} locale="az" />),
  );

  await expect(component.locator(".product-card")).toHaveCount(0);
  await expect(component.locator(".shimmer")).toHaveCount(0);
});
