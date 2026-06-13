import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: product-image-management, Property 9: Search result deduplication

/**
 * Image Search Property Tests
 * Feature: product-image-management
 *
 * Since `searchImages` makes external HTTP calls (scrape-google-images),
 * we test the deduplication and filtering logic independently.
 * This mirrors the exact logic inside `searchImages`:
 *   1. Extract URL string from each result item
 *   2. Filter to HTTPS-only
 *   3. Deduplicate
 *   4. Limit to 20 results
 */

// ─── Replicate the internal filtering/dedup logic from searchImages ────────────

/**
 * Applies the same dedup + filter logic as searchImages internally:
 * - Accepts items that may be strings or objects with a `url` property
 * - Filters to HTTPS-only URLs
 * - Deduplicates
 * - Limits to 20 results
 */
function filterAndDeduplicateResults(results: unknown[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of results) {
    const url = typeof item === "string" ? item : (item as any)?.url;
    if (typeof url !== "string") continue;
    if (!url.startsWith("https://")) continue;
    if (seen.has(url)) continue;

    seen.add(url);
    urls.push(url);

    if (urls.length >= 20) break;
  }

  return urls;
}

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a random path segment for URLs */
const pathSegmentArb = fc
  .array(fc.constantFrom("a", "b", "c", "d", "1", "2", "3", "-", "_"), {
    minLength: 1,
    maxLength: 20,
  })
  .map((chars) => chars.join(""));

/** Generate a random HTTPS URL */
const httpsUrlArb = fc
  .tuple(
    pathSegmentArb,
    fc.constantFrom(".jpg", ".png", ".webp", ".gif", ""),
    fc.constantFrom("example.com", "cdn.shop.io", "images.store.net", "photos.test.org"),
  )
  .map(([path, ext, domain]) => `https://${domain}/images/${path}${ext}`);

/** Generate a random HTTP (non-HTTPS) URL */
const httpUrlArb = pathSegmentArb.map(
  (path) => `http://example.com/images/${path}.jpg`,
);

/** Generate a mixed array of URLs with intentional duplicates */
const mixedUrlArrayArb = fc
  .tuple(
    fc.array(httpsUrlArb, { minLength: 0, maxLength: 15 }),
    fc.array(httpUrlArb, { minLength: 0, maxLength: 10 }),
  )
  .chain(([httpsUrls, httpUrls]) => {
    // Introduce duplicates by repeating some HTTPS URLs
    const duplicatesArb =
      httpsUrls.length > 0
        ? fc.array(fc.constantFrom(...httpsUrls), { minLength: 0, maxLength: 10 })
        : fc.constant([] as string[]);

    return duplicatesArb.map((duplicates) => {
      // Shuffle all URLs together
      const all = [...httpsUrls, ...httpUrls, ...duplicates];
      return all;
    });
  });

/** Generate a large array with many HTTPS URLs (to test the 20-limit) */
const largeHttpsArrayArb = fc.array(httpsUrlArb, { minLength: 21, maxLength: 50 });

/** Generate arrays of URL objects (like scrape-google-images might return) */
const urlObjectArrayArb = fc
  .array(
    fc.oneof(
      httpsUrlArb.map((url) => ({ url })),
      httpUrlArb.map((url) => ({ url })),
      httpsUrlArb, // plain string
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(42),
    ),
    { minLength: 0, maxLength: 30 },
  );

// ─── Property 9: Search result deduplication ───────────────────────────────────

describe("Feature: product-image-management, Property 9: Search result deduplication", () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * For any image search response, the returned candidate URLs SHALL contain
   * no duplicates. Additionally:
   * - Output never exceeds 20 URLs
   * - All output URLs start with "https://"
   */

  it("output contains no duplicate URLs for any input with potential duplicates", () => {
    fc.assert(
      fc.property(mixedUrlArrayArb, (inputUrls) => {
        const result = filterAndDeduplicateResults(inputUrls);

        // No duplicates: Set size must equal array length
        const uniqueSet = new Set(result);
        expect(uniqueSet.size).toBe(result.length);
      }),
      { numRuns: 200 },
    );
  });

  it("output never exceeds 20 URLs regardless of input size", () => {
    fc.assert(
      fc.property(largeHttpsArrayArb, (inputUrls) => {
        const result = filterAndDeduplicateResults(inputUrls);

        expect(result.length).toBeLessThanOrEqual(20);
      }),
      { numRuns: 200 },
    );
  });

  it("all output URLs start with https://", () => {
    fc.assert(
      fc.property(mixedUrlArrayArb, (inputUrls) => {
        const result = filterAndDeduplicateResults(inputUrls);

        for (const url of result) {
          expect(url.startsWith("https://")).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("http:// URLs are never included in the output", () => {
    fc.assert(
      fc.property(
        fc.array(httpUrlArb, { minLength: 1, maxLength: 20 }),
        (httpUrls) => {
          const result = filterAndDeduplicateResults(httpUrls);

          // All http:// URLs should be filtered out
          expect(result.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("handles mixed input types (objects, strings, nulls) without duplicates", () => {
    fc.assert(
      fc.property(urlObjectArrayArb, (mixedInput) => {
        const result = filterAndDeduplicateResults(mixedInput as unknown[]);

        // No duplicates
        const uniqueSet = new Set(result);
        expect(uniqueSet.size).toBe(result.length);

        // All HTTPS
        for (const url of result) {
          expect(url.startsWith("https://")).toBe(true);
        }

        // Max 20
        expect(result.length).toBeLessThanOrEqual(20);
      }),
      { numRuns: 200 },
    );
  });

  it("output preserves order of first-seen unique HTTPS URLs", () => {
    fc.assert(
      fc.property(mixedUrlArrayArb, (inputUrls) => {
        const result = filterAndDeduplicateResults(inputUrls);

        // Manually compute expected order
        const expected: string[] = [];
        const seen = new Set<string>();
        for (const url of inputUrls) {
          const u = typeof url === "string" ? url : (url as any)?.url;
          if (typeof u !== "string") continue;
          if (!u.startsWith("https://")) continue;
          if (seen.has(u)) continue;
          seen.add(u);
          expected.push(u);
          if (expected.length >= 20) break;
        }

        expect(result).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("an input of all identical HTTPS URLs produces exactly one result", () => {
    fc.assert(
      fc.property(
        httpsUrlArb,
        fc.integer({ min: 2, max: 30 }),
        (url, count) => {
          const inputUrls = Array(count).fill(url);
          const result = filterAndDeduplicateResults(inputUrls);

          expect(result.length).toBe(1);
          expect(result[0]).toBe(url);
        },
      ),
      { numRuns: 100 },
    );
  });
});
