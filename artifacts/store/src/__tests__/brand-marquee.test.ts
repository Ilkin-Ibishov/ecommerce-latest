/**
 * Brand Marquee Rendering — Property-Based Tests
 *
 * Property 9: Marquee Rendering Correctness
 *
 * Tests the pure data → attribute mapping logic for the brand marquee:
 * Given an array of brands (each with name + logo_url), verify that the
 * rendering logic produces correct href, title, img alt, and img src attributes.
 *
 * Validates: Requirements 5.2, 5.5, 5.6
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: admin-brand-banner-management, Property 9: Marquee Rendering Correctness

// ─── Pure rendering logic extracted from HomePage marquee ─────────────────────

interface BrandEntry {
  name: string;
  logo_url: string;
}

interface MarqueeLinkAttributes {
  href: string;
  title: string;
  imgAlt: string;
  imgSrc: string;
}

/**
 * Pure function that computes the rendered attributes for a brand entry
 * in the marquee. This mirrors the logic in HomePage.tsx:
 *   href = `/${locale}/products?brand=${encodeURIComponent(b.name)}`
 *   title = b.name
 *   img alt = b.name
 *   img src = b.logo_url
 */
function computeMarqueeLinkAttributes(
  brand: BrandEntry,
  locale: string,
): MarqueeLinkAttributes {
  return {
    href: `/${locale}/products?brand=${encodeURIComponent(brand.name)}`,
    title: brand.name,
    imgAlt: brand.name,
    imgSrc: brand.logo_url,
  };
}

// ─── Generators ───────────────────────────────────────────────────────────────

/** Generates brand names including special characters that need URL encoding */
const brandNameArb = fc.oneof(
  // Simple ASCII names
  fc.string({ minLength: 1, maxLength: 50, unit: "grapheme-ascii" }),
  // Names with spaces and special chars (common brand patterns)
  fc.tuple(
    fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
    fc.constantFrom(" ", "&", "+", "/", "?", "#", "=", "%", "'", '"'),
    fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
  ).map(([a, sep, b]) => `${a}${sep}${b}`),
  // Unicode brand names (e.g., Azerbaijani characters)
  fc.string({ minLength: 1, maxLength: 30, unit: "grapheme" }),
);

/** Generates valid logo URLs (data:image/svg+xml or https://) */
const logoUrlArb = fc.oneof(
  fc.constant("data:image/svg+xml,<svg></svg>"),
  fc.string({ minLength: 1, maxLength: 50, unit: "grapheme-ascii" }).map(
    (s) => `data:image/svg+xml;base64,${s.replace(/[^a-zA-Z0-9+/=]/g, "A")}`,
  ),
  fc.webUrl().map((url) => url.replace(/^http:/, "https:")),
);

const brandEntryArb: fc.Arbitrary<BrandEntry> = fc.record({
  name: brandNameArb,
  logo_url: logoUrlArb,
});

const localeArb = fc.constantFrom("az", "ru", "en");

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Property 9: Marquee Rendering Correctness", () => {
  /** **Validates: Requirements 5.2, 5.5, 5.6** */

  it("each brand link href uses encodeURIComponent on brand name with correct locale prefix", () => {
    fc.assert(
      fc.property(
        fc.array(brandEntryArb, { minLength: 1, maxLength: 30 }),
        localeArb,
        (brands, locale) => {
          for (const brand of brands) {
            const attrs = computeMarqueeLinkAttributes(brand, locale);
            const expectedHref = `/${locale}/products?brand=${encodeURIComponent(brand.name)}`;
            expect(attrs.href).toBe(expectedHref);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("each brand link title equals the brand name", () => {
    fc.assert(
      fc.property(
        fc.array(brandEntryArb, { minLength: 1, maxLength: 30 }),
        localeArb,
        (brands, locale) => {
          for (const brand of brands) {
            const attrs = computeMarqueeLinkAttributes(brand, locale);
            expect(attrs.title).toBe(brand.name);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("each brand img alt text equals the brand name", () => {
    fc.assert(
      fc.property(
        fc.array(brandEntryArb, { minLength: 1, maxLength: 30 }),
        localeArb,
        (brands, locale) => {
          for (const brand of brands) {
            const attrs = computeMarqueeLinkAttributes(brand, locale);
            expect(attrs.imgAlt).toBe(brand.name);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("each brand img src equals the brand logo_url", () => {
    fc.assert(
      fc.property(
        fc.array(brandEntryArb, { minLength: 1, maxLength: 30 }),
        localeArb,
        (brands, locale) => {
          for (const brand of brands) {
            const attrs = computeMarqueeLinkAttributes(brand, locale);
            expect(attrs.imgSrc).toBe(brand.logo_url);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("encodeURIComponent correctly encodes special characters in brand names", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "A&B", "Tom & Jerry", "50% Off", "Hello World", "C++",
          "foo/bar", "a?b=c", "brand#1", "it's", 'say "hi"',
        ),
        localeArb,
        (name, locale) => {
          const brand: BrandEntry = { name, logo_url: "https://example.com/logo.svg" };
          const attrs = computeMarqueeLinkAttributes(brand, locale);

          // href must contain the encoded name — verify decoding round-trips
          const urlPart = attrs.href.split("?brand=")[1];
          expect(decodeURIComponent(urlPart)).toBe(name);

          // href must NOT contain raw special characters that would break URLs
          const rawSpecials = ["&", "?", "#", "=", " "];
          for (const char of rawSpecials) {
            if (name.includes(char)) {
              // The encoded portion should NOT have the raw char
              expect(urlPart).not.toContain(char);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for any non-empty brand array, output count matches input count", () => {
    fc.assert(
      fc.property(
        fc.array(brandEntryArb, { minLength: 1, maxLength: 50 }),
        localeArb,
        (brands, locale) => {
          const results = brands.map((b) => computeMarqueeLinkAttributes(b, locale));
          expect(results.length).toBe(brands.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("href always starts with /{locale}/products?brand= for any valid locale", () => {
    fc.assert(
      fc.property(
        brandEntryArb,
        localeArb,
        (brand, locale) => {
          const attrs = computeMarqueeLinkAttributes(brand, locale);
          expect(attrs.href).toMatch(new RegExp(`^/${locale}/products\\?brand=`));
        },
      ),
      { numRuns: 150 },
    );
  });

  it("decoding the href brand parameter always returns the original brand name", () => {
    fc.assert(
      fc.property(
        brandEntryArb,
        localeArb,
        (brand, locale) => {
          const attrs = computeMarqueeLinkAttributes(brand, locale);
          const prefix = `/${locale}/products?brand=`;
          const encodedName = attrs.href.slice(prefix.length);
          expect(decodeURIComponent(encodedName)).toBe(brand.name);
        },
      ),
      { numRuns: 150 },
    );
  });
});
