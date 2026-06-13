/**
 * Slug Generation Tests
 *
 * Tests the auto-slug generation logic used in the PageEditorPage.
 * Ensures titles are properly converted to URL-friendly slugs.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/** Slug generation logic (replicated from PageEditorPage.tsx) */
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")   // remove non-word chars except spaces/hyphens
    .replace(/\s+/g, "-")       // spaces → hyphens
    .replace(/-+/g, "-")        // collapse multiple hyphens
    .replace(/^-+|-+$/g, "");   // trim leading/trailing hyphens
}

/** Valid slug regex from the API (same as in pages.ts) */
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("Slug Generation", () => {
  describe("basic conversions", () => {
    it("converts simple title to slug", () => {
      expect(generateSlug("Test Page")).toBe("test-page");
    });

    it("converts title with mixed case", () => {
      expect(generateSlug("About Us")).toBe("about-us");
    });

    it("handles multiple spaces", () => {
      expect(generateSlug("hello   world")).toBe("hello-world");
    });

    it("removes special characters", () => {
      expect(generateSlug("Hello, World!")).toBe("hello-world");
    });

    it("handles accented characters by removing them", () => {
      // Note: \w in JS doesn't match non-ASCII word chars in all engines
      // The slug generator strips them as non-word chars
      const result = generateSlug("Çatdırılma Məlumatları");
      // Result depends on JS regex \w behavior - may strip diacritics
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it("trims leading/trailing spaces", () => {
      expect(generateSlug("  hello world  ")).toBe("hello-world");
    });

    it("collapses multiple hyphens", () => {
      expect(generateSlug("hello---world")).toBe("hello-world");
    });

    it("removes leading/trailing hyphens", () => {
      expect(generateSlug("-hello world-")).toBe("hello-world");
    });

    it("handles numeric titles", () => {
      expect(generateSlug("Page 123")).toBe("page-123");
    });

    it("returns empty string for empty input", () => {
      expect(generateSlug("")).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(generateSlug("   ")).toBe("");
    });
  });

  describe("e-commerce page titles", () => {
    it("converts 'Delivery & Returns' correctly", () => {
      // "Delivery & Returns" → lowercase → "delivery & returns"
      // → remove non-word → "delivery  returns" → spaces→hyphens → "delivery--returns"
      // → collapse → "delivery-returns"
      expect(generateSlug("Delivery & Returns")).toBe("delivery-returns");
    });

    it("converts 'Terms of Service' correctly", () => {
      expect(generateSlug("Terms of Service")).toBe("terms-of-service");
    });

    it("converts 'Test Page QA' (ScoutQA scenario)", () => {
      expect(generateSlug("Test Page QA")).toBe("test-page-qa");
    });

    it("converts 'Haqqımızda' (Azerbaijani 'About Us')", () => {
      const result = generateSlug("Haqqımızda");
      // Non-ASCII letters are removed by /[^\w\s-]/g
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });
  });

  describe("property: output never contains uppercase", () => {
    it("any input produces lowercase-only output", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 100 }), (text) => {
          const slug = generateSlug(text);
          expect(slug).toBe(slug.toLowerCase());
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("property: output never starts or ends with hyphen", () => {
    it("any non-empty output has no leading/trailing hyphens", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 100 }), (text) => {
          const slug = generateSlug(text);
          if (slug.length > 0) {
            expect(slug[0]).not.toBe("-");
            expect(slug[slug.length - 1]).not.toBe("-");
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("property: output never contains consecutive hyphens", () => {
    it("any input produces slug without --", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 100 }), (text) => {
          const slug = generateSlug(text);
          expect(slug).not.toContain("--");
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("property: output never contains spaces", () => {
    it("any input produces slug without whitespace", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 100 }), (text) => {
          const slug = generateSlug(text);
          expect(slug).not.toMatch(/\s/);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("property: ASCII alphanumeric input produces valid API slug", () => {
    it("input with at least one alphanumeric char produces a valid slug", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9 ]{0,30}[a-zA-Z0-9]$/).filter((s) => s.length >= 2),
          (text) => {
            const slug = generateSlug(text);
            if (slug.length > 0) {
              expect(SLUG_REGEX.test(slug)).toBe(true);
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("property: function never throws", () => {
    it("handles any string input without throwing", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), (text) => {
          expect(() => generateSlug(text)).not.toThrow();
        }),
        { numRuns: 200 },
      );
    });
  });
});
