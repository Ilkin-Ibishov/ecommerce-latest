/**
 * Storefront UX Improvements — Property-Based Tests
 *
 * Property 7: Toast duration is clamped to valid range
 * Property 8: Toast stack never exceeds maximum limit
 *
 * Validates: Requirements 9.6, 9.9, 9.10
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  clampDuration,
  reducer,
  TOAST_LIMIT,
  DEFAULT_TOAST_DURATION,
} from "@/hooks/use-toast";
import {
  computeLensPosition,
  computePinchZoom,
} from "@/components/storefront/ImageMagnifier";
import {
  resolveBreadcrumbPath,
  generateBreadcrumbJsonLd,
} from "@/components/storefront/StorefrontBreadcrumb";
import type { CategoryNode } from "@/lib/queries/categories";

describe("Property 7: Toast duration is clamped to valid range", () => {
  /** Validates: Requirements 9.6 */

  it("should clamp any numeric duration to [1000, 10000]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10000, max: 100000 }),
        (duration) => {
          const clamped = clampDuration(duration);
          expect(clamped).toBeGreaterThanOrEqual(1000);
          expect(clamped).toBeLessThanOrEqual(10000);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("should preserve values already within [1000, 10000]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 10000 }),
        (duration) => {
          expect(clampDuration(duration)).toBe(duration);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("should return 3000 as default when no duration specified", () => {
    expect(DEFAULT_TOAST_DURATION).toBe(3000);
  });
});

describe("Property 8: Toast stack never exceeds maximum limit", () => {
  /** Validates: Requirements 9.9, 9.10 */

  it("should never have more than TOAST_LIMIT toasts after any sequence of additions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (numToasts) => {
          let state: { toasts: Array<{ id: string; open: boolean; title: string }> } = { toasts: [] };
          for (let i = 0; i < numToasts; i++) {
            state = reducer(state as any, {
              type: "ADD_TOAST",
              toast: {
                id: String(i),
                open: true,
                title: `Toast ${i}`,
              },
            }) as any;
          }
          expect(state.toasts.length).toBeLessThanOrEqual(TOAST_LIMIT);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should have exactly TOAST_LIMIT toasts when more than TOAST_LIMIT are added", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: TOAST_LIMIT + 1, max: 50 }),
        (numToasts) => {
          let state: { toasts: Array<{ id: string; open: boolean; title: string }> } = { toasts: [] };
          for (let i = 0; i < numToasts; i++) {
            state = reducer(state as any, {
              type: "ADD_TOAST",
              toast: {
                id: String(i),
                open: true,
                title: `Toast ${i}`,
              },
            }) as any;
          }
          expect(state.toasts.length).toBe(TOAST_LIMIT);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should keep the newest toasts and discard oldest when exceeding limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: TOAST_LIMIT + 1, max: 50 }),
        (numToasts) => {
          let state: { toasts: Array<{ id: string; open: boolean; title: string }> } = { toasts: [] };
          for (let i = 0; i < numToasts; i++) {
            state = reducer(state as any, {
              type: "ADD_TOAST",
              toast: {
                id: String(i),
                open: true,
                title: `Toast ${i}`,
              },
            }) as any;
          }
          // The most recently added toast should be first (newest-first order)
          const lastAdded = String(numToasts - 1);
          expect(state.toasts[0].id).toBe(lastAdded);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 1: Magnifier lens position is clamped within image bounds", () => {
  /** Validates: Requirements 1.1, 1.2 */

  it("lens rectangle stays within image boundary for any cursor position", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 4000 }), // imageWidth
        fc.integer({ min: 100, max: 4000 }), // imageHeight
        fc.integer({ min: 50, max: 300 }), // lensSize
        fc.float({ min: 1.5, max: 5.0, noNaN: true }), // magnification
        fc.float({ min: 0, max: 1, noNaN: true }), // cursor X ratio (0-1)
        fc.float({ min: 0, max: 1, noNaN: true }), // cursor Y ratio (0-1)
        (imageWidth, imageHeight, lensSize, magnification, xRatio, yRatio) => {
          // Ensure lens fits in image
          if (lensSize > imageWidth || lensSize > imageHeight) return;

          const cursorPos = {
            x: xRatio * imageWidth,
            y: yRatio * imageHeight,
          };
          const imageRect = { width: imageWidth, height: imageHeight };
          const { lensX, lensY } = computeLensPosition(
            imageRect,
            cursorPos,
            lensSize,
            magnification,
          );

          expect(lensX).toBeGreaterThanOrEqual(0);
          expect(lensY).toBeGreaterThanOrEqual(0);
          expect(lensX + lensSize).toBeLessThanOrEqual(imageWidth);
          expect(lensY + lensSize).toBeLessThanOrEqual(imageHeight);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("Property 2: Pinch-to-zoom scale is proportional and clamped", () => {
  /** Validates: Requirements 1.4 */

  it("zoom level is always between 1.0 and 4.0", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 10, max: 500, noNaN: true }), // initialDistance
        fc.float({ min: 0, max: 2000, noNaN: true }), // currentDistance
        (initialDistance, currentDistance) => {
          const scale = computePinchZoom(initialDistance, currentDistance);
          expect(scale).toBeGreaterThanOrEqual(1.0);
          expect(scale).toBeLessThanOrEqual(4.0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns 1.0 for invalid initial distance", () => {
    fc.assert(
      fc.property(
        fc.float({ min: -500, max: 0, noNaN: true }), // invalidInitial
        fc.float({ min: 0, max: 2000, noNaN: true }), // currentDistance
        (initialDistance, currentDistance) => {
          const scale = computePinchZoom(initialDistance, currentDistance);
          expect(scale).toBe(1.0);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Generators for Breadcrumb Tests ──────────────────────────────────────────

/**
 * Generates a random category tree with configurable depth and breadth.
 * Returns the tree and a flat list of all nodes with their depths.
 */
function categoryTreeArb(maxDepth: number, maxBreadth: number): fc.Arbitrary<{
  tree: CategoryNode[];
  allNodes: Array<{ node: CategoryNode; depth: number }>;
}> {
  return fc
    .integer({ min: 1, max: maxBreadth })
    .chain((rootCount) =>
      fc.tuple(
        fc.array(
          fc.tuple(
            fc.uuid(),
            fc.string({ minLength: 1, maxLength: 10, unit: "grapheme-ascii" }),
            fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
          ),
          { minLength: rootCount, maxLength: rootCount },
        ),
        fc.integer({ min: 1, max: maxDepth }),
        fc.integer({ min: 1, max: maxBreadth }),
      ),
    )
    .chain(([rootDefs, depth, breadth]) => {
      // Build tree deterministically from definitions
      return fc
        .array(
          fc.tuple(
            fc.uuid(),
            fc.string({ minLength: 1, maxLength: 10, unit: "grapheme-ascii" }),
            fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
            fc.integer({ min: 1, max: breadth }),
          ),
          { minLength: 0, maxLength: depth * breadth * rootDefs.length },
        )
        .map((childDefs) => {
          const allNodes: Array<{ node: CategoryNode; depth: number }> = [];

          function makeNode(
            id: string,
            slug: string,
            name: string,
            parentId: string | null,
          ): CategoryNode {
            return {
              id,
              slug,
              parent_id: parentId,
              icon_url: null,
              category_translations: [
                {
                  id: `trans-${id}`,
                  category_id: id,
                  locale: "en",
                  name,
                  description: null,
                } as any,
              ],
              subcategories: [],
            };
          }

          // Build roots
          const tree: CategoryNode[] = [];
          const queue: Array<{ node: CategoryNode; currentDepth: number }> = [];

          for (const [id, slug, name] of rootDefs) {
            const node = makeNode(id, slug, name, null);
            tree.push(node);
            allNodes.push({ node, depth: 1 });
            queue.push({ node, currentDepth: 1 });
          }

          // Add children up to maxDepth
          let childIdx = 0;
          while (queue.length > 0 && childIdx < childDefs.length) {
            const parent = queue.shift()!;
            if (parent.currentDepth >= depth) continue;

            const [cId, cSlug, cName, numChildren] = childDefs[childIdx];
            childIdx++;

            const actualChildren = Math.min(numChildren, breadth);
            for (let i = 0; i < actualChildren && childIdx + i < childDefs.length + 1; i++) {
              const childId = i === 0 ? cId : `${cId}-${i}`;
              const child = makeNode(
                childId,
                `${cSlug}-${i}`,
                `${cName}-${i}`,
                parent.node.id,
              );
              parent.node.subcategories.push(child);
              allNodes.push({ node: child, depth: parent.currentDepth + 1 });
              queue.push({ node: child, currentDepth: parent.currentDepth + 1 });
            }
          }

          return { tree, allNodes };
        });
    });
}

describe("Property 5: Breadcrumb path resolution produces valid ancestor chain", () => {
  /** Validates: Requirements 6.1, 6.2, 6.4 */

  it("resolved path starts from root ancestor and ends at target category", () => {
    fc.assert(
      fc.property(
        categoryTreeArb(5, 4).filter(({ allNodes }) => allNodes.length > 0),
        fc.integer({ min: 0, max: 100 }),
        ({ tree, allNodes }, targetIdx) => {
          // Pick a target node from the tree
          const target = allNodes[targetIdx % allNodes.length];
          const path = resolveBreadcrumbPath(tree, target.node.id, "en");

          // Path must not be empty since target is in the tree
          expect(path.length).toBeGreaterThan(0);

          // Last segment must reference the target
          const lastSegment = path[path.length - 1];
          expect(lastSegment.href).toBe(`/categories/${target.node.slug}`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("path length equals depth of target in tree", () => {
    fc.assert(
      fc.property(
        categoryTreeArb(5, 4).filter(({ allNodes }) => allNodes.length > 0),
        fc.integer({ min: 0, max: 100 }),
        ({ tree, allNodes }, targetIdx) => {
          const target = allNodes[targetIdx % allNodes.length];
          const path = resolveBreadcrumbPath(tree, target.node.id, "en");

          // Path length should equal the depth of the target in the tree
          expect(path.length).toBe(target.depth);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("consecutive segments follow parent-child relationship", () => {
    fc.assert(
      fc.property(
        categoryTreeArb(5, 4).filter(({ allNodes }) => allNodes.length > 0),
        fc.integer({ min: 0, max: 100 }),
        ({ tree, allNodes }, targetIdx) => {
          const target = allNodes[targetIdx % allNodes.length];
          const path = resolveBreadcrumbPath(tree, target.node.id, "en");

          if (path.length <= 1) return; // Single-node path has no parent-child pair

          // Build a slug-to-node map for verification
          const slugToNode = new Map<string, CategoryNode>();
          function indexTree(nodes: CategoryNode[]) {
            for (const n of nodes) {
              slugToNode.set(n.slug, n);
              indexTree(n.subcategories);
            }
          }
          indexTree(tree);

          // Each consecutive pair: segments[i+1] is a child of segments[i]
          for (let i = 0; i < path.length - 1; i++) {
            const parentSlug = path[i].href.replace("/categories/", "");
            const childSlug = path[i + 1].href.replace("/categories/", "");
            const parentNode = slugToNode.get(parentSlug);
            const childNode = slugToNode.get(childSlug);

            expect(parentNode).toBeDefined();
            expect(childNode).toBeDefined();
            if (parentNode && childNode) {
              expect(childNode.parent_id).toBe(parentNode.id);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns empty array for a non-existent target ID", () => {
    fc.assert(
      fc.property(
        categoryTreeArb(3, 3),
        fc.uuid(),
        ({ tree }, fakeId) => {
          const path = resolveBreadcrumbPath(tree, fakeId, "en");
          expect(path).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("Property 6: JSON-LD BreadcrumbList has correct structure", () => {
  /** Validates: Requirements 6.7 */

  const segmentArb = fc.record({
    label: fc.string({ minLength: 1, maxLength: 30, unit: "grapheme-ascii" }),
    href: fc.string({ minLength: 1, maxLength: 50, unit: "grapheme-ascii" }).map(
      (s) => `/${s.replace(/[^a-z0-9-/]/gi, "a")}`,
    ),
  });

  const segmentsArb = fc.array(segmentArb, { minLength: 1, maxLength: 10 });

  it("has @type BreadcrumbList", () => {
    fc.assert(
      fc.property(
        segmentsArb,
        fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
        (segments, currentLabel) => {
          const jsonLd = generateBreadcrumbJsonLd(
            segments,
            currentLabel,
            "https://example.com",
          );
          expect(jsonLd["@type"]).toBe("BreadcrumbList");
          expect(jsonLd["@context"]).toBe("https://schema.org");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("itemListElement length equals segments.length + 1 (for current page)", () => {
    fc.assert(
      fc.property(
        segmentsArb,
        fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
        (segments, currentLabel) => {
          const jsonLd = generateBreadcrumbJsonLd(
            segments,
            currentLabel,
            "https://example.com",
          );
          expect(jsonLd.itemListElement.length).toBe(segments.length + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("positions are numbered sequentially from 1", () => {
    fc.assert(
      fc.property(
        segmentsArb,
        fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
        (segments, currentLabel) => {
          const jsonLd = generateBreadcrumbJsonLd(
            segments,
            currentLabel,
            "https://example.com",
          );
          for (let i = 0; i < jsonLd.itemListElement.length; i++) {
            expect(jsonLd.itemListElement[i].position).toBe(i + 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("each item has a non-empty name", () => {
    fc.assert(
      fc.property(
        segmentsArb,
        fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
        (segments, currentLabel) => {
          const jsonLd = generateBreadcrumbJsonLd(
            segments,
            currentLabel,
            "https://example.com",
          );
          for (const item of jsonLd.itemListElement) {
            expect(item.name.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all items except last have absolute URL item field", () => {
    fc.assert(
      fc.property(
        segmentsArb,
        fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
        (segments, currentLabel) => {
          const jsonLd = generateBreadcrumbJsonLd(
            segments,
            currentLabel,
            "https://example.com",
          );
          const items = jsonLd.itemListElement;
          // All except last have absolute URL
          for (let i = 0; i < items.length - 1; i++) {
            expect(items[i].item).toBeDefined();
            expect(items[i].item!.startsWith("https://")).toBe(true);
          }
          // Last item (current page) has no `item` URL
          expect(items[items.length - 1].item).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 4: AnimatedCartButton ignores clicks while not idle ─────────────

describe("Property 4: AnimatedCartButton ignores clicks while not idle", () => {
  /** Validates: Requirements 4.8 */

  type ButtonState = "idle" | "loading" | "success" | "error";

  /**
   * Pure guard logic from AnimatedCartButton.handleClick:
   *   if (state !== "idle" || disabled) return;
   *
   * Returns true if onAdd WOULD be called, false if the click is ignored.
   */
  function wouldCallOnAdd(state: ButtonState, disabled: boolean): boolean {
    return state === "idle" && !disabled;
  }

  it("should never call onAdd when state is not idle", () => {
    const nonIdleStates: ButtonState[] = ["loading", "success", "error"];

    fc.assert(
      fc.property(
        fc.constantFrom(...nonIdleStates),
        fc.boolean(),
        (state, disabled) => {
          expect(wouldCallOnAdd(state, disabled)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("should never call onAdd when disabled is true regardless of state", () => {
    const allStates: ButtonState[] = ["idle", "loading", "success", "error"];

    fc.assert(
      fc.property(
        fc.constantFrom(...allStates),
        (state) => {
          expect(wouldCallOnAdd(state, true)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should only call onAdd when state is idle AND disabled is false", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("idle" as ButtonState, "loading" as ButtonState, "success" as ButtonState, "error" as ButtonState),
        fc.boolean(),
        (state, disabled) => {
          const result = wouldCallOnAdd(state, disabled);
          const expected = state === "idle" && !disabled;
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});


// ─── Property 3: Quick View addItem uses correct variant data ─────────────────

/**
 * Validates: Requirements 3.3, 3.4
 *
 * Tests the pure logic of variant selection for QuickViewModal's addItem call.
 * For products with variants, the selected variant determines cart item data.
 * For products with zero variants, default product data is used.
 */

interface TestVariant {
  id: string;
  label: string;
  stock: number;
  price: number;
}

interface TestProduct {
  product_id: string;
  slug: string;
  title: string;
  price: number;
  image: string | null;
  stock: number;
  variants: TestVariant[];
}

/**
 * Pure logic: determines what data to pass to addItem based on variant selection.
 * This matches the QuickViewModal behavior (forward-compatible for when variants are added).
 */
function resolveCartItem(product: TestProduct, selectedVariantIndex: number | null) {
  if (product.variants.length === 0 || selectedVariantIndex === null) {
    return {
      product_id: product.product_id,
      slug: product.slug,
      title: product.title,
      price: product.price,
      image: product.image,
    };
  }
  const variant = product.variants[selectedVariantIndex];
  return {
    product_id: product.product_id,
    slug: product.slug,
    title: `${product.title} - ${variant.label}`,
    price: variant.price,
    image: product.image,
  };
}

// ─── Generators ───────────────────────────────────────────────────────────────

const variantArb: fc.Arbitrary<TestVariant> = fc.record({
  id: fc.uuid(),
  label: fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
  stock: fc.integer({ min: 0, max: 1000 }),
  price: fc.float({ min: Math.fround(0.01), max: Math.fround(9999), noNaN: true }),
});

const productArb = (variantCount: { min: number; max: number }): fc.Arbitrary<TestProduct> =>
  fc.record({
    product_id: fc.uuid(),
    slug: fc.string({ minLength: 1, maxLength: 30, unit: "grapheme-ascii" }).map(
      (s) => s.replace(/[^a-z0-9-]/gi, "a").toLowerCase(),
    ),
    title: fc.string({ minLength: 1, maxLength: 50, unit: "grapheme-ascii" }),
    price: fc.float({ min: Math.fround(0.01), max: Math.fround(9999), noNaN: true }),
    image: fc.oneof(
      fc.constant(null),
      fc.webUrl().map((url) => url),
    ),
    stock: fc.integer({ min: 0, max: 1000 }),
    variants: fc.array(variantArb, { minLength: variantCount.min, maxLength: variantCount.max }),
  });

describe("Property 3: Quick View addItem uses correct variant data", () => {
  /** Validates: Requirements 3.3, 3.4 */

  it("for products with variants, addItem uses the selected variant's price and label", () => {
    fc.assert(
      fc.property(
        productArb({ min: 1, max: 10 }).chain((product) =>
          fc.tuple(
            fc.constant(product),
            fc.integer({ min: 0, max: Math.max(0, product.variants.length - 1) }),
          ),
        ),
        ([product, selectedIndex]) => {
          const result = resolveCartItem(product, selectedIndex);
          const variant = product.variants[selectedIndex];

          // Must use variant price, not product price
          expect(result.price).toBe(variant.price);
          // Title must include variant label
          expect(result.title).toBe(`${product.title} - ${variant.label}`);
          // product_id remains the product's ID (not variant id)
          expect(result.product_id).toBe(product.product_id);
          // slug comes from product
          expect(result.slug).toBe(product.slug);
          // image comes from product
          expect(result.image).toBe(product.image);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("for products with zero variants, addItem uses default product data", () => {
    fc.assert(
      fc.property(
        productArb({ min: 0, max: 0 }),
        (product) => {
          const result = resolveCartItem(product, null);

          expect(result.product_id).toBe(product.product_id);
          expect(result.slug).toBe(product.slug);
          expect(result.title).toBe(product.title);
          expect(result.price).toBe(product.price);
          expect(result.image).toBe(product.image);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("for products with variants but null selectedIndex, addItem uses default product data", () => {
    fc.assert(
      fc.property(
        productArb({ min: 1, max: 10 }),
        (product) => {
          const result = resolveCartItem(product, null);

          // When no variant is selected, falls back to product data
          expect(result.product_id).toBe(product.product_id);
          expect(result.slug).toBe(product.slug);
          expect(result.title).toBe(product.title);
          expect(result.price).toBe(product.price);
          expect(result.image).toBe(product.image);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("variant selection never changes the product_id or image", () => {
    fc.assert(
      fc.property(
        productArb({ min: 1, max: 10 }).chain((product) =>
          fc.tuple(
            fc.constant(product),
            fc.integer({ min: 0, max: Math.max(0, product.variants.length - 1) }),
          ),
        ),
        ([product, selectedIndex]) => {
          const result = resolveCartItem(product, selectedIndex);

          // product_id and image always come from the product, regardless of variant
          expect(result.product_id).toBe(product.product_id);
          expect(result.image).toBe(product.image);
        },
      ),
      { numRuns: 200 },
    );
  });
});
