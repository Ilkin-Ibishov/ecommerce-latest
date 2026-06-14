import { describe, it, expect } from "vitest";
import {
  makeProduct,
  makeProducts,
  SAMPLE_IMAGE_URL,
  type ProductFixture,
} from "../../tests/helpers/fixtures";

// Exercises the shared tests/helpers/ fixtures so the helper module stays live
// and consistent with the api-server helper structure (R17.2).

describe("tests/helpers/fixtures — makeProduct", () => {
  it("returns the default healthy product when no overrides are given", () => {
    const product = makeProduct();
    expect(product).toEqual<ProductFixture>({
      title: "Widget",
      slug: "widget",
      brand: "Acme",
      stock: 5,
      price: 10,
      categoryIds: [],
    });
  });

  it("applies overrides on top of the defaults", () => {
    const product = makeProduct({ title: "Custom", stock: 0, brand: null });
    expect(product.title).toBe("Custom");
    expect(product.stock).toBe(0);
    expect(product.brand).toBeNull();
    // untouched defaults remain
    expect(product.slug).toBe("widget");
    expect(product.price).toBe(10);
  });

  it("does not share the categoryIds array reference between instances", () => {
    const a = makeProduct();
    const b = makeProduct();
    a.categoryIds.push("c1");
    expect(b.categoryIds).toEqual([]);
  });
});

describe("tests/helpers/fixtures — makeProducts", () => {
  it("builds the requested count with deterministic unique slugs/titles", () => {
    const products = makeProducts(3);
    expect(products).toHaveLength(3);
    expect(products.map((p) => p.slug)).toEqual(["product-1", "product-2", "product-3"]);
    expect(products.map((p) => p.title)).toEqual(["Product 1", "Product 2", "Product 3"]);
  });

  it("returns an empty array for non-positive counts", () => {
    expect(makeProducts(0)).toEqual([]);
    expect(makeProducts(-5)).toEqual([]);
  });

  it("threads per-index overrides", () => {
    const products = makeProducts(2, (i) => ({ stock: i * 10 }));
    expect(products.map((p) => p.stock)).toEqual([0, 10]);
  });
});

describe("tests/helpers/fixtures — SAMPLE_IMAGE_URL", () => {
  it("is a valid HTTPS URL", () => {
    expect(SAMPLE_IMAGE_URL.startsWith("https://")).toBe(true);
    expect(() => new URL(SAMPLE_IMAGE_URL)).not.toThrow();
  });
});
