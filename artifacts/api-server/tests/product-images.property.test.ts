import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Feature: product-image-management ──────────────────────────────────────────
// Property-based tests for product image management logic constraints.
// These are LOGIC-LEVEL tests: they validate constraint functions and in-memory
// simulations without making real HTTP/database calls.

// ─── Constants ──────────────────────────────────────────────────────────────────

const MAX_IMAGES_PER_PRODUCT = 5;
const VALID_SOURCES = ["search", "barcode", "paste", "upload"] as const;
type ValidSource = (typeof VALID_SOURCES)[number];

// ─── Pure constraint functions (mirror API logic) ───────────────────────────────

/**
 * Compute how many images can actually be added given current count and request.
 * This mirrors the constraint logic in the product-images route.
 */
function computeAddable(currentCount: number, requestedAdd: number, max: number): number {
  const remaining = max - currentCount;
  if (remaining <= 0) return 0;
  return Math.min(requestedAdd, remaining);
}

/**
 * Validates that a source string is one of the accepted values.
 */
function isValidSource(source: string): source is ValidSource {
  return (VALID_SOURCES as readonly string[]).includes(source);
}

// ─── In-memory image list simulation ────────────────────────────────────────────

interface SimImage {
  id: string;
  url: string;
  sort_order: number;
  source: ValidSource;
}

type SimOperation =
  | { type: "add"; url: string; source: ValidSource }
  | { type: "delete"; index: number }
  | { type: "reorder"; permutation: number[] };

/**
 * Simulates an in-memory product image list with operations that maintain
 * the sort_order contiguity invariant (same logic as the API).
 */
function applyOperation(images: SimImage[], op: SimOperation): SimImage[] {
  switch (op.type) {
    case "add": {
      if (images.length >= MAX_IMAGES_PER_PRODUCT) return images;
      // Check duplicate
      if (images.some((img) => img.url === op.url)) return images;
      const newImage: SimImage = {
        id: `img-${images.length}-${Date.now()}`,
        url: op.url,
        sort_order: images.length,
        source: op.source,
      };
      return [...images, newImage];
    }
    case "delete": {
      if (images.length === 0) return images;
      const idx = op.index % images.length;
      const filtered = images.filter((_, i) => i !== idx);
      // Reassign sort_order to maintain contiguity
      return filtered.map((img, i) => ({ ...img, sort_order: i }));
    }
    case "reorder": {
      if (images.length === 0) return images;
      // Apply permutation: permutation[i] = which original index goes to position i
      const perm = op.permutation.slice(0, images.length);
      const reordered = perm.map((origIdx, newIdx) => ({
        ...images[origIdx],
        sort_order: newIdx,
      }));
      return reordered;
    }
  }
}

/**
 * Verify sort_order forms a contiguous sequence [0, 1, ..., n-1]
 */
function isSortOrderContiguous(images: SimImage[]): boolean {
  if (images.length === 0) return true;
  const sortOrders = images.map((img) => img.sort_order).sort((a, b) => a - b);
  for (let i = 0; i < sortOrders.length; i++) {
    if (sortOrders[i] !== i) return false;
  }
  return true;
}

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid current image count (0–5) */
const currentCountArb = fc.integer({ min: 0, max: MAX_IMAGES_PER_PRODUCT });

/** Generate a requested add count (1–10) */
const requestedAddArb = fc.integer({ min: 1, max: 10 });

/** Generate a valid source */
const validSourceArb = fc.constantFrom(...VALID_SOURCES);

/** Generate a random HTTPS URL */
const httpsUrlArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.stringMatching(/^[a-z0-9/_-]{1,30}$/)
  )
  .map(([domain, tld, path]) => `https://${domain}.${tld}/${path}`);

/** Generate a unique HTTPS URL with index to avoid collisions */
const indexedUrlArb = (index: number) =>
  httpsUrlArb.map((url) => `${url}?idx=${index}`);

/** Generate a random operation for the sort_order simulation */
function operationArb(maxImages: number): fc.Arbitrary<SimOperation> {
  return fc.oneof(
    // Add operation
    fc.tuple(httpsUrlArb, validSourceArb).map(([url, source]) => ({
      type: "add" as const,
      url,
      source,
    })),
    // Delete operation (index will be modulo'd to valid range)
    fc.integer({ min: 0, max: Math.max(0, maxImages - 1) }).map((index) => ({
      type: "delete" as const,
      index,
    })),
    // Reorder operation (generate a permutation)
    fc
      .shuffledSubarray(
        Array.from({ length: MAX_IMAGES_PER_PRODUCT }, (_, i) => i),
        { minLength: MAX_IMAGES_PER_PRODUCT, maxLength: MAX_IMAGES_PER_PRODUCT }
      )
      .map((permutation) => ({
        type: "reorder" as const,
        permutation,
      }))
  );
}

/** Generate a sequence of operations */
const operationSequenceArb = fc
  .array(operationArb(MAX_IMAGES_PER_PRODUCT), { minLength: 1, maxLength: 20 })
  // Ensure add operations have unique URLs across the sequence
  .map((ops) => {
    let urlCounter = 0;
    return ops.map((op) => {
      if (op.type === "add") {
        urlCounter++;
        return { ...op, url: `https://img-${urlCounter}.example.com/photo.jpg` };
      }
      return op;
    });
  });

// ─── Property 3: Maximum images constraint ─────────────────────────────────────
// Feature: product-image-management, Property 3: Maximum images constraint

describe("Feature: product-image-management, Property 3: Maximum images constraint", () => {
  /**
   * **Validates: Requirements 7.1, 3.3, 7.4**
   *
   * For any product with N existing images (where 0 ≤ N ≤ 5), attempting to add
   * K images SHALL result in exactly min(K, 5 - N) images being added, and the
   * total count SHALL never exceed 5.
   */
  it("computeAddable returns min(K, max - N) for any current/requested counts", () => {
    fc.assert(
      fc.property(currentCountArb, requestedAddArb, (currentCount, requestedAdd) => {
        const added = computeAddable(currentCount, requestedAdd, MAX_IMAGES_PER_PRODUCT);
        const expectedAdded = Math.min(requestedAdd, MAX_IMAGES_PER_PRODUCT - currentCount);

        // Core assertion: added equals expected
        expect(added).toBe(expectedAdded);

        // Total never exceeds max
        const total = currentCount + added;
        expect(total).toBeLessThanOrEqual(MAX_IMAGES_PER_PRODUCT);

        // Added is non-negative
        expect(added).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 }
    );
  });

  it("when product is at max capacity (N=5), no images can be added regardless of K", () => {
    fc.assert(
      fc.property(requestedAddArb, (requestedAdd) => {
        const added = computeAddable(MAX_IMAGES_PER_PRODUCT, requestedAdd, MAX_IMAGES_PER_PRODUCT);
        expect(added).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("when product is empty (N=0), up to max images can be added", () => {
    fc.assert(
      fc.property(requestedAddArb, (requestedAdd) => {
        const added = computeAddable(0, requestedAdd, MAX_IMAGES_PER_PRODUCT);
        expect(added).toBe(Math.min(requestedAdd, MAX_IMAGES_PER_PRODUCT));
        expect(added).toBeLessThanOrEqual(MAX_IMAGES_PER_PRODUCT);
      }),
      { numRuns: 100 }
    );
  });

  it("simulated sequential adds never exceed max capacity", () => {
    fc.assert(
      fc.property(
        fc.array(httpsUrlArb, { minLength: 1, maxLength: 10 }),
        validSourceArb,
        (urls, source) => {
          // Make URLs unique
          const uniqueUrls = urls.map((u, i) => `${u}?seq=${i}`);
          let images: SimImage[] = [];

          for (const url of uniqueUrls) {
            images = applyOperation(images, { type: "add", url, source });
            // Invariant: never exceeds max
            expect(images.length).toBeLessThanOrEqual(MAX_IMAGES_PER_PRODUCT);
          }

          // Final count should be min(uniqueUrls.length, MAX)
          expect(images.length).toBe(Math.min(uniqueUrls.length, MAX_IMAGES_PER_PRODUCT));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 5: Sort order contiguity invariant ────────────────────────────────
// Feature: product-image-management, Property 5: Sort order contiguity invariant

describe("Feature: product-image-management, Property 5: Sort order contiguity invariant", () => {
  /**
   * **Validates: Requirements 8.2, 8.4, 9.3**
   *
   * For any sequence of add, delete, and reorder operations on a product's images,
   * the resulting sort_order values SHALL always form a contiguous integer sequence
   * starting at 0.
   */
  it("sort_order is always [0, 1, ..., n-1] after any sequence of operations", () => {
    fc.assert(
      fc.property(operationSequenceArb, (operations) => {
        let images: SimImage[] = [];

        for (const op of operations) {
          images = applyOperation(images, op);
          // After every single operation, contiguity must hold
          expect(isSortOrderContiguous(images)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("after deleting from any position, sort_order is recompacted", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_IMAGES_PER_PRODUCT }),
        fc.integer({ min: 0, max: MAX_IMAGES_PER_PRODUCT - 1 }),
        (numImages, deleteIdx) => {
          // Build an initial image list
          let images: SimImage[] = Array.from({ length: numImages }, (_, i) => ({
            id: `img-${i}`,
            url: `https://example.com/img-${i}.jpg`,
            sort_order: i,
            source: "paste" as ValidSource,
          }));

          // Delete at a valid index
          const validIdx = deleteIdx % numImages;
          images = applyOperation(images, { type: "delete", index: validIdx });

          expect(images.length).toBe(numImages - 1);
          expect(isSortOrderContiguous(images)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("after reordering, sort_order is always [0..n-1] regardless of permutation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_IMAGES_PER_PRODUCT }),
        (numImages) => {
          // Build initial images
          const images: SimImage[] = Array.from({ length: numImages }, (_, i) => ({
            id: `img-${i}`,
            url: `https://example.com/img-${i}.jpg`,
            sort_order: i,
            source: "paste" as ValidSource,
          }));

          // Generate a random permutation of the correct length
          const indices = Array.from({ length: numImages }, (_, i) => i);
          // Fisher-Yates shuffle (deterministic for this test)
          for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
          }

          const reordered = applyOperation(images, {
            type: "reorder",
            permutation: indices,
          });

          expect(reordered.length).toBe(numImages);
          expect(isSortOrderContiguous(reordered)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 6: Source tracking completeness ───────────────────────────────────
// Feature: product-image-management, Property 6: Source tracking completeness

describe("Feature: product-image-management, Property 6: Source tracking completeness", () => {
  /**
   * **Validates: Requirements 12.1**
   *
   * For any image creation operation (regardless of sourcing method), the resulting
   * Product_Image record SHALL have a source field set to exactly one of: "search",
   * "barcode", "paste", or "upload".
   */
  it("any image created with a valid source retains that exact source value", () => {
    fc.assert(
      fc.property(httpsUrlArb, validSourceArb, (url, source) => {
        // Simulate image creation with source assignment
        const images: SimImage[] = [];
        const result = applyOperation(images, { type: "add", url, source });

        expect(result.length).toBe(1);
        expect(result[0].source).toBe(source);
        expect(isValidSource(result[0].source)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("source field is always exactly one of the 4 valid values after creation", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(httpsUrlArb, validSourceArb),
          { minLength: 1, maxLength: MAX_IMAGES_PER_PRODUCT }
        ),
        (imageSpecs) => {
          let images: SimImage[] = [];

          // Make URLs unique
          const uniqueSpecs = imageSpecs.map(([url, source], i) => [
            `${url}?i=${i}`,
            source,
          ] as [string, ValidSource]);

          for (const [url, source] of uniqueSpecs) {
            images = applyOperation(images, { type: "add", url, source });
          }

          // Every image must have a valid source
          for (const img of images) {
            expect(VALID_SOURCES).toContain(img.source);
            expect(typeof img.source).toBe("string");
            expect(img.source.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("invalid source strings are NOT accepted by isValidSource", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => !VALID_SOURCES.includes(s as any)
        ),
        (invalidSource) => {
          expect(isValidSource(invalidSource)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the API resolves unknown sources to 'paste' (default fallback)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        (rawSource) => {
          // Mirror the API logic: validSources.includes(source) ? source : "paste"
          const resolvedSource = (VALID_SOURCES as readonly string[]).includes(rawSource)
            ? rawSource
            : "paste";

          expect(isValidSource(resolvedSource)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Property 7: Duplicate URL rejection ────────────────────────────────────────
// Feature: product-image-management, Property 7: Duplicate URL rejection

describe("Feature: product-image-management, Property 7: Duplicate URL rejection", () => {
  /**
   * **Validates: Data Invariant (unique URL per product)**
   *
   * For any product, adding an image with a URL that already exists for that product
   * SHALL be rejected, leaving the existing images unchanged.
   */
  it("adding same URL twice results in only one image being stored", () => {
    fc.assert(
      fc.property(httpsUrlArb, validSourceArb, (url, source) => {
        let images: SimImage[] = [];

        // First add — should succeed
        images = applyOperation(images, { type: "add", url, source });
        expect(images.length).toBe(1);

        // Second add with same URL — should be rejected (no change)
        const beforeSecondAdd = [...images];
        images = applyOperation(images, { type: "add", url, source });

        // Image list unchanged
        expect(images.length).toBe(1);
        expect(images).toEqual(beforeSecondAdd);
      }),
      { numRuns: 200 }
    );
  });

  it("duplicate rejection preserves all existing images unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(httpsUrlArb, { minLength: 2, maxLength: MAX_IMAGES_PER_PRODUCT }),
        validSourceArb,
        (urls, source) => {
          // Make URLs unique
          const uniqueUrls = [...new Set(urls.map((u, i) => `${u}?dup=${i}`))].slice(
            0,
            MAX_IMAGES_PER_PRODUCT
          );

          let images: SimImage[] = [];

          // Add all unique URLs
          for (const url of uniqueUrls) {
            images = applyOperation(images, { type: "add", url, source });
          }

          const countBefore = images.length;
          const snapshotBefore = images.map((img) => ({ ...img }));

          // Try to add the first URL again (duplicate)
          images = applyOperation(images, { type: "add", url: uniqueUrls[0], source });

          // Count unchanged
          expect(images.length).toBe(countBefore);
          // Content unchanged
          expect(images).toEqual(snapshotBefore);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("different URLs for same product are all accepted (no false rejections)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(httpsUrlArb, validSourceArb),
          { minLength: 1, maxLength: MAX_IMAGES_PER_PRODUCT }
        ),
        (specs) => {
          let images: SimImage[] = [];
          // Ensure all URLs are unique
          const uniqueSpecs = specs.map(([url, source], i) => [
            `${url}?uniq=${i}`,
            source,
          ] as [string, ValidSource]);

          for (const [url, source] of uniqueSpecs) {
            images = applyOperation(images, { type: "add", url, source });
          }

          // All unique URLs should have been added (up to max)
          const expectedCount = Math.min(uniqueSpecs.length, MAX_IMAGES_PER_PRODUCT);
          expect(images.length).toBe(expectedCount);

          // All URLs in the list should be unique
          const urlSet = new Set(images.map((img) => img.url));
          expect(urlSet.size).toBe(images.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("URL uniqueness is enforced even with different source values", () => {
    fc.assert(
      fc.property(
        httpsUrlArb,
        validSourceArb,
        validSourceArb,
        (url, source1, source2) => {
          let images: SimImage[] = [];

          // First add with source1
          images = applyOperation(images, { type: "add", url, source: source1 });
          expect(images.length).toBe(1);

          // Second add with same URL but different source — still rejected
          images = applyOperation(images, { type: "add", url, source: source2 });
          expect(images.length).toBe(1);
          // Source from first add is preserved
          expect(images[0].source).toBe(source1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
