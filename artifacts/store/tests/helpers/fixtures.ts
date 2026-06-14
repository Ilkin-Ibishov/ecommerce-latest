/**
 * Shared test fixtures for store unit/property tests.
 *
 * Mirrors the helper-module convention used by the API server
 * (`artifacts/api-server/tests/helpers/`). Store vitest unit/property specs
 * live under `src/__tests__/`; import these helpers via a relative path,
 * e.g. `import { makeProduct } from "../../tests/helpers/fixtures";`.
 *
 * Keep these lightweight and dependency-free so they can be consumed from the
 * node-environment vitest project without extra setup.
 */

/** Minimal product shape shared across admin/storefront list tests. */
export interface ProductFixture {
  title: string;
  slug: string;
  brand: string | null;
  stock: number;
  price: number;
  categoryIds: string[];
}

const DEFAULT_PRODUCT: ProductFixture = {
  title: "Widget",
  slug: "widget",
  brand: "Acme",
  stock: 5,
  price: 10,
  categoryIds: [],
};

/**
 * Build a single product fixture, overriding any subset of fields.
 * Defaults represent a healthy, in-stock product.
 */
export function makeProduct(overrides: Partial<ProductFixture> = {}): ProductFixture {
  // Clone categoryIds so fixtures never share a mutable array reference.
  return { ...DEFAULT_PRODUCT, categoryIds: [...DEFAULT_PRODUCT.categoryIds], ...overrides };
}

/**
 * Build `count` product fixtures with deterministic, unique slugs/titles.
 * Useful for pagination and list-rendering assertions.
 */
export function makeProducts(
  count: number,
  overrides: (index: number) => Partial<ProductFixture> = () => ({}),
): ProductFixture[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    makeProduct({ title: `Product ${i + 1}`, slug: `product-${i + 1}`, ...overrides(i) }),
  );
}

/** A known-good HTTPS image URL for image-proxy/url tests. */
export const SAMPLE_IMAGE_URL = "https://example.com/images/product.jpg";
