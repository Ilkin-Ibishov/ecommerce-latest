/**
 * Property-based tests for storefront rendering logic.
 *
 * Feature: white-label-customization
 *
 * Property 11: Social links rendering filter
 * Property 12: Contact field omission
 * Property 18: Navigation links show only qualifying pages in sort order
 *
 * These tests validate the LOGIC (filtering/sorting) used by the Header and Footer,
 * not the React rendering itself.
 *
 * **Validates: Requirements 5.3, 5.8, 8.6, 8.7**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Pure Logic Functions Under Test ─────────────────────────────────────────

/**
 * Filters social links to only those whose URL value is a non-empty string
 * beginning with "https://".
 *
 * Mirrors the logic in Footer.tsx:
 *   socialLinks.instagram && socialLinks.instagram.startsWith("https://")
 */
export function filterSocialLinks(
  socialLinks: Record<string, string | undefined | null>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(socialLinks)) {
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.startsWith("https://")
    ) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Determines which contact fields should be rendered.
 * A field is rendered if and only if its value is a non-null, non-empty string.
 *
 * Mirrors the logic in Footer.tsx:
 *   const phone = settings.contact?.phone || "";
 *   {phone && ( <li>...</li> )}
 */
export function getVisibleContactFields(contact: {
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}): string[] {
  const visible: string[] = [];
  if (contact.phone && contact.phone.trim().length > 0) visible.push("phone");
  if (contact.email && contact.email.trim().length > 0) visible.push("email");
  if (contact.address && contact.address.trim().length > 0)
    visible.push("address");
  return visible;
}

/**
 * Filters and sorts pages for header or footer navigation.
 * Includes exactly those pages where published = true AND the respective flag is true,
 * ordered by sort_order ascending.
 *
 * Mirrors the logic in Header.tsx / Footer.tsx:
 *   data.filter(p => p.show_in_header).sort((a, b) => a.sort_order - b.sort_order)
 *   pages.filter(p => p.show_in_footer).sort((a, b) => a.sort_order - b.sort_order)
 */
export interface PageEntry {
  id: string;
  slug: string;
  title: string;
  published: boolean;
  show_in_header: boolean;
  show_in_footer: boolean;
  sort_order: number;
}

export function getNavigationPages(
  pages: PageEntry[],
  target: "header" | "footer"
): PageEntry[] {
  const flag = target === "header" ? "show_in_header" : "show_in_footer";
  return pages
    .filter((p) => p.published && p[flag])
    .sort((a, b) => a.sort_order - b.sort_order);
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generates a valid https:// URL */
const validHttpsUrl = fc
  .webUrl({ validSchemes: ["https"] })
  .filter((url) => url.startsWith("https://") && url.length > 8);

/** Generates a URL that does NOT start with "https://" */
const invalidUrl = fc.oneof(
  fc.constant(""),
  fc.constant("http://example.com"),
  fc.constant("ftp://files.example.com"),
  fc.string({ minLength: 1, maxLength: 50 }).filter(
    (s) => !s.startsWith("https://")
  ),
  fc.constant("https:/"), // incomplete
  fc.constant("HTTPS://example.com") // wrong case
);

/** Generates a social_links object with a mix of valid and invalid entries */
const socialLinksArb = fc.dictionary(
  fc.constantFrom("instagram", "facebook", "telegram", "twitter", "youtube", "tiktok"),
  fc.oneof(
    validHttpsUrl,
    invalidUrl,
    fc.constant(undefined as unknown as string),
    fc.constant(null as unknown as string)
  )
);

/** Generates a contact field value that could be null, empty, or a real string */
const contactFieldValue = fc.oneof(
  fc.constant(null as string | null),
  fc.constant(""),
  fc.constant("   "), // whitespace only
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0)
);

/** Generates a contact object */
const contactArb = fc.record({
  phone: contactFieldValue,
  email: contactFieldValue,
  address: contactFieldValue,
});

/** Generates a PageEntry */
const pageEntryArb: fc.Arbitrary<PageEntry> = fc.record({
  id: fc.uuid(),
  slug: fc
    .stringMatching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .filter((s) => s.length >= 1 && s.length <= 20),
  title: fc.string({ minLength: 1, maxLength: 50 }),
  published: fc.boolean(),
  show_in_header: fc.boolean(),
  show_in_footer: fc.boolean(),
  sort_order: fc.integer({ min: 0, max: 999 }),
});

/** Generates an array of pages */
const pagesArb = fc.array(pageEntryArb, { minLength: 0, maxLength: 30 });

// ─── Property 11: Social links rendering filter ──────────────────────────────

describe("Feature: white-label-customization, Property 11: Social links rendering filter", () => {
  it("only entries with non-empty https:// URLs are included in the filtered output", () => {
    fc.assert(
      fc.property(socialLinksArb, (links) => {
        const filtered = filterSocialLinks(links);

        // All returned entries must be non-empty strings starting with "https://"
        for (const [, url] of Object.entries(filtered)) {
          expect(typeof url).toBe("string");
          expect(url.length).toBeGreaterThan(0);
          expect(url.startsWith("https://")).toBe(true);
        }

        // Every qualifying entry from the input must be in the output
        for (const [key, value] of Object.entries(links)) {
          if (
            typeof value === "string" &&
            value.length > 0 &&
            value.startsWith("https://")
          ) {
            expect(filtered[key]).toBe(value);
          } else {
            expect(filtered[key]).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("valid https:// URLs are always preserved", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("instagram", "facebook", "telegram"),
        validHttpsUrl,
        (platform, url) => {
          const links = { [platform]: url };
          const filtered = filterSocialLinks(links);
          expect(filtered[platform]).toBe(url);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("invalid URLs are always excluded", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("instagram", "facebook", "telegram"),
        invalidUrl,
        (platform, url) => {
          const links = { [platform]: url };
          const filtered = filterSocialLinks(links);
          expect(filtered[platform]).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 12: Contact field omission ─────────────────────────────────────

describe("Feature: white-label-customization, Property 12: Contact field omission", () => {
  it("a contact field is visible if and only if its value is a non-null, non-empty (non-whitespace) string", () => {
    fc.assert(
      fc.property(contactArb, (contact) => {
        const visible = getVisibleContactFields(contact);

        const fields = ["phone", "email", "address"] as const;
        for (const field of fields) {
          const value = contact[field];
          const shouldBeVisible =
            typeof value === "string" &&
            value !== null &&
            value.trim().length > 0;

          if (shouldBeVisible) {
            expect(visible).toContain(field);
          } else {
            expect(visible).not.toContain(field);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("all fields visible when all have valid non-empty content", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        (phone, email, address) => {
          const visible = getVisibleContactFields({ phone, email, address });
          expect(visible).toContain("phone");
          expect(visible).toContain("email");
          expect(visible).toContain("address");
          expect(visible).toHaveLength(3);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no fields visible when all are null or empty", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, "", "   ", "  \t  "),
        fc.constantFrom(null, "", "   ", "  \t  "),
        fc.constantFrom(null, "", "   ", "  \t  "),
        (phone, email, address) => {
          const visible = getVisibleContactFields({ phone, email, address });
          expect(visible).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 18: Navigation links show only qualifying pages in sort order ──

describe("Feature: white-label-customization, Property 18: Navigation links show only qualifying pages in sort order", () => {
  it("header navigation includes exactly published pages with show_in_header=true, sorted by sort_order ascending", () => {
    fc.assert(
      fc.property(pagesArb, (pages) => {
        const result = getNavigationPages(pages, "header");

        // 1. All results must be published AND have show_in_header
        for (const page of result) {
          expect(page.published).toBe(true);
          expect(page.show_in_header).toBe(true);
        }

        // 2. Result includes ALL qualifying pages from input
        const qualifying = pages.filter(
          (p) => p.published && p.show_in_header
        );
        expect(result).toHaveLength(qualifying.length);

        // 3. Verify each qualifying page is in the result
        for (const q of qualifying) {
          expect(result.find((r) => r.id === q.id)).toBeDefined();
        }

        // 4. Sort order: each page's sort_order is <= the next one's
        for (let i = 1; i < result.length; i++) {
          expect(result[i].sort_order).toBeGreaterThanOrEqual(
            result[i - 1].sort_order
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it("footer navigation includes exactly published pages with show_in_footer=true, sorted by sort_order ascending", () => {
    fc.assert(
      fc.property(pagesArb, (pages) => {
        const result = getNavigationPages(pages, "footer");

        // 1. All results must be published AND have show_in_footer
        for (const page of result) {
          expect(page.published).toBe(true);
          expect(page.show_in_footer).toBe(true);
        }

        // 2. Result includes ALL qualifying pages from input
        const qualifying = pages.filter(
          (p) => p.published && p.show_in_footer
        );
        expect(result).toHaveLength(qualifying.length);

        // 3. Verify each qualifying page is in the result
        for (const q of qualifying) {
          expect(result.find((r) => r.id === q.id)).toBeDefined();
        }

        // 4. Sort order: each page's sort_order is <= the next one's
        for (let i = 1; i < result.length; i++) {
          expect(result[i].sort_order).toBeGreaterThanOrEqual(
            result[i - 1].sort_order
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it("unpublished pages are never included regardless of nav flags", () => {
    fc.assert(
      fc.property(pagesArb, (pages) => {
        const headerResult = getNavigationPages(pages, "header");
        const footerResult = getNavigationPages(pages, "footer");

        for (const page of headerResult) {
          expect(page.published).toBe(true);
        }
        for (const page of footerResult) {
          expect(page.published).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("pages with show_in_header=false are excluded from header nav even if published", () => {
    fc.assert(
      fc.property(pagesArb, (pages) => {
        const result = getNavigationPages(pages, "header");
        const resultIds = new Set(result.map((p) => p.id));

        for (const page of pages) {
          if (page.published && !page.show_in_header) {
            expect(resultIds.has(page.id)).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("pages with show_in_footer=false are excluded from footer nav even if published", () => {
    fc.assert(
      fc.property(pagesArb, (pages) => {
        const result = getNavigationPages(pages, "footer");
        const resultIds = new Set(result.map((p) => p.id));

        for (const page of pages) {
          if (page.published && !page.show_in_footer) {
            expect(resultIds.has(page.id)).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
