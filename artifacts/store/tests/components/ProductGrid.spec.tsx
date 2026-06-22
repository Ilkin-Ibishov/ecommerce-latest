import { test, expect } from "@playwright/experimental-ct-react";
import { ProductGridHarness } from "./harness/ProductGridHarness";
import type { ProductCardData } from "@/components/storefront/ProductGrid";

// ProductGrid renders ProductCard which uses useCart()/useI18n(), wouter <Link>,
// and QuickViewModal (useQuery). The harness provides all required providers.

const products: ProductCardData[] = [
  { id: "p1", slug: "alpha", title: "Alpha Product", price: 10 },
  { id: "p2", slug: "bravo", title: "Bravo Product", price: 20 },
  { id: "p3", slug: "charlie", title: "Charlie Product", price: 30 },
];

test("renders the skeleton grid and no product cards while loading", async ({ mount }) => {
  const component = await mount(
    <ProductGridHarness products={products} loading={true} locale="az" />,
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
    <ProductGridHarness products={products} loading={false} locale="az" />,
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
    <ProductGridHarness products={[]} loading={false} locale="az" />,
  );

  await expect(component.locator(".product-card")).toHaveCount(0);
  await expect(component.locator(".shimmer")).toHaveCount(0);
});
