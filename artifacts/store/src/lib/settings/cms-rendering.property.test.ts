/**
 * Property-based tests for CMS rendering logic.
 *
 * Feature: white-label-customization
 *
 * Property 17: Page translation locale fallback
 * Property 19: Page visibility determines response
 * Property 20: Hreflang tags match existing translations
 *
 * These tests validate pure logic functions (locale fallback resolution,
 * page visibility determination, hreflang tag generation) — not React rendering.
 *
 * **Validates: Requirements 7.5, 8.4, 9.5**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Supported Locales ───────────────────────────────────────────────────────

const SUPPORTED_LOCALES = ["az", "ru", "en"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

// ─── Pure Logic Functions Under Test ─────────────────────────────────────────

/**
 * Resolves which translation to display for a given page and active locale.
 *
 * Fallback chain: active locale → az → null (content not available).
 *
 * Mirrors the logic in pages.ts GET /api/pages/:slug endpoint:
 *   let translation = translations.find(t => t.locale === resolvedLocale);
 *   if (!translation) translation = translations.find(t => t.locale === "az");
 *   if (!translation) → 404 "Translation not available"
 */
export interface PageTranslation {
  locale: string;
  title: string;
  content: string;
}

export type TranslationResult =
  | { type: "found"; translation: PageTranslation }
  | { type: "not_available" };

export function resolveTranslation(
  translations: PageTranslation[],
  activeLocale: string
): TranslationResult {
  // Try active locale first
  const activeMatch = translations.find((t) => t.locale === activeLocale);
  if (activeMatch) {
    return { type: "found", translation: activeMatch };
  }

  // Fall back to "az" locale
  const azFallback = translations.find((t) => t.locale === "az");
  if (azFallback) {
    return { type: "found", translation: azFallback };
  }

  // No translation available
  return { type: "not_available" };
}

/**
 * Determines whether a page request should return content (200) or not-found (404).
 *
 * A page is visible if and only if:
 * 1. The page exists
 * 2. The page is published (published = true)
 * 3. A translation exists for the resolved locale (after fallback: active → az)
 *
 * Mirrors the logic in pages.ts GET /api/pages/:slug:
 *   - .eq("published", true) filter
 *   - Translation fallback: active locale → az → 404
 */
export interface PageRecord {
  exists: boolean;
  published: boolean;
  translations: PageTranslation[];
}

export type VisibilityResult =
  | { type: "visible"; translation: PageTranslation }
  | { type: "not_found" };

export function determinePageVisibility(
  page: PageRecord,
  requestedLocale: string
): VisibilityResult {
  // Page must exist
  if (!page.exists) {
    return { type: "not_found" };
  }

  // Page must be published
  if (!page.published) {
    return { type: "not_found" };
  }

  // Must have a translation for resolved locale (after fallback)
  const result = resolveTranslation(page.translations, requestedLocale);
  if (result.type === "not_available") {
    return { type: "not_found" };
  }

  return { type: "visible", translation: result.translation };
}

/**
 * Generates hreflang tag entries for a CMS page.
 *
 * The set of hreflang tags corresponds exactly to the set of locales
 * for which a page_translations record exists for that page.
 *
 * Mirrors the logic in CmsPage.tsx:
 *   for (const loc of available_locales) {
 *     // create <link rel="alternate" hreflang={loc} href={...}>
 *   }
 */
export interface HreflangEntry {
  locale: string;
  href: string;
}

export function generateHreflangTags(
  availableLocales: string[],
  slug: string,
  origin: string
): HreflangEntry[] {
  return availableLocales.map((locale) => ({
    locale,
    href: `${origin}/${locale}/page/${slug}`,
  }));
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generates a valid locale from the supported set */
const localeArb = fc.constantFrom(...SUPPORTED_LOCALES);

/** Generates a non-empty translation title */
const titleArb = fc.string({ minLength: 1, maxLength: 100 });

/** Generates translation content */
const contentArb = fc.string({ minLength: 0, maxLength: 200 });

/** Generates a single PageTranslation */
const translationArb: fc.Arbitrary<PageTranslation> = fc.record({
  locale: localeArb,
  title: titleArb,
  content: contentArb,
});

/**
 * Generates a set of translations with unique locales.
 * Each locale appears at most once (matching the UNIQUE constraint on page_id+locale).
 */
const uniqueTranslationsArb: fc.Arbitrary<PageTranslation[]> = fc
  .subarray(SUPPORTED_LOCALES as unknown as Locale[], { minLength: 0, maxLength: 3 })
  .chain((locales) =>
    fc.tuple(...locales.map((locale) =>
      fc.record({
        locale: fc.constant(locale),
        title: titleArb,
        content: contentArb,
      })
    ))
  );

/** Generates a valid slug */
const slugArb = fc
  .stringMatching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .filter((s) => s.length >= 1 && s.length <= 30);

/** Generates a page record (exists/published flags + translations) */
const pageRecordArb: fc.Arbitrary<PageRecord> = fc.record({
  exists: fc.boolean(),
  published: fc.boolean(),
  translations: uniqueTranslationsArb,
});

/** Generates an origin URL */
const originArb = fc.constant("https://store.example.com");

// ─── Property 17: Page translation locale fallback ───────────────────────────

describe("Feature: white-label-customization, Property 17: Page translation locale fallback", () => {
  it("returns the active locale translation when it exists", () => {
    fc.assert(
      fc.property(uniqueTranslationsArb, localeArb, (translations, activeLocale) => {
        const activeTranslation = translations.find((t) => t.locale === activeLocale);

        // Only test cases where active locale translation exists
        fc.pre(activeTranslation !== undefined);

        const result = resolveTranslation(translations, activeLocale);
        expect(result.type).toBe("found");
        if (result.type === "found") {
          expect(result.translation.locale).toBe(activeLocale);
          expect(result.translation).toEqual(activeTranslation);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("falls back to az locale when active locale translation does not exist but az does", () => {
    fc.assert(
      fc.property(uniqueTranslationsArb, localeArb, (translations, activeLocale) => {
        const activeTranslation = translations.find((t) => t.locale === activeLocale);
        const azTranslation = translations.find((t) => t.locale === "az");

        // Only test cases where: no active locale BUT az exists
        fc.pre(activeTranslation === undefined && azTranslation !== undefined);

        const result = resolveTranslation(translations, activeLocale);
        expect(result.type).toBe("found");
        if (result.type === "found") {
          expect(result.translation.locale).toBe("az");
          expect(result.translation).toEqual(azTranslation);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("returns not_available when neither active locale nor az translation exists", () => {
    fc.assert(
      fc.property(uniqueTranslationsArb, localeArb, (translations, activeLocale) => {
        const activeTranslation = translations.find((t) => t.locale === activeLocale);
        const azTranslation = translations.find((t) => t.locale === "az");

        // Only test cases where neither active locale nor az exist
        fc.pre(activeTranslation === undefined && azTranslation === undefined);

        const result = resolveTranslation(translations, activeLocale);
        expect(result.type).toBe("not_available");
      }),
      { numRuns: 100 }
    );
  });

  it("the full fallback chain holds: active → az → not_available", () => {
    fc.assert(
      fc.property(uniqueTranslationsArb, localeArb, (translations, activeLocale) => {
        const result = resolveTranslation(translations, activeLocale);
        const activeExists = translations.some((t) => t.locale === activeLocale);
        const azExists = translations.some((t) => t.locale === "az");

        if (activeExists) {
          // Must return the active locale translation
          expect(result.type).toBe("found");
          if (result.type === "found") {
            expect(result.translation.locale).toBe(activeLocale);
          }
        } else if (azExists) {
          // Must fall back to az
          expect(result.type).toBe("found");
          if (result.type === "found") {
            expect(result.translation.locale).toBe("az");
          }
        } else {
          // Must return not_available
          expect(result.type).toBe("not_available");
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 19: Page visibility determines response ────────────────────────

describe("Feature: white-label-customization, Property 19: Page visibility determines response", () => {
  it("page is visible if and only if it exists AND is published AND has a translation (after fallback)", () => {
    fc.assert(
      fc.property(pageRecordArb, localeArb, (page, requestedLocale) => {
        const result = determinePageVisibility(page, requestedLocale);

        const translationResolved = resolveTranslation(page.translations, requestedLocale);
        const shouldBeVisible =
          page.exists && page.published && translationResolved.type === "found";

        if (shouldBeVisible) {
          expect(result.type).toBe("visible");
          if (result.type === "visible") {
            // The translation returned must match the fallback logic
            expect(result.translation).toEqual(
              (translationResolved as { type: "found"; translation: PageTranslation }).translation
            );
          }
        } else {
          expect(result.type).toBe("not_found");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("non-existent pages always return not_found regardless of other fields", () => {
    fc.assert(
      fc.property(
        fc.record({
          exists: fc.constant(false),
          published: fc.boolean(),
          translations: uniqueTranslationsArb,
        }),
        localeArb,
        (page, locale) => {
          const result = determinePageVisibility(page, locale);
          expect(result.type).toBe("not_found");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("unpublished pages always return not_found regardless of translations", () => {
    fc.assert(
      fc.property(
        fc.record({
          exists: fc.constant(true),
          published: fc.constant(false),
          translations: uniqueTranslationsArb,
        }),
        localeArb,
        (page, locale) => {
          const result = determinePageVisibility(page, locale);
          expect(result.type).toBe("not_found");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("published page with no translations returns not_found", () => {
    fc.assert(
      fc.property(localeArb, (locale) => {
        const page: PageRecord = {
          exists: true,
          published: true,
          translations: [],
        };
        const result = determinePageVisibility(page, locale);
        expect(result.type).toBe("not_found");
      }),
      { numRuns: 100 }
    );
  });

  it("published page with matching translation returns visible", () => {
    fc.assert(
      fc.property(localeArb, titleArb, contentArb, (locale, title, content) => {
        const page: PageRecord = {
          exists: true,
          published: true,
          translations: [{ locale, title, content }],
        };
        const result = determinePageVisibility(page, locale);
        expect(result.type).toBe("visible");
        if (result.type === "visible") {
          expect(result.translation.locale).toBe(locale);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 20: Hreflang tags match existing translations ──────────────────

describe("Feature: white-label-customization, Property 20: Hreflang tags match existing translations", () => {
  it("hreflang tags correspond exactly to the set of locales with translations", () => {
    fc.assert(
      fc.property(
        uniqueTranslationsArb,
        slugArb,
        originArb,
        (translations, slug, origin) => {
          const availableLocales = translations.map((t) => t.locale);
          const tags = generateHreflangTags(availableLocales, slug, origin);

          // Number of hreflang tags equals number of available translations
          expect(tags).toHaveLength(availableLocales.length);

          // Each available locale has exactly one hreflang tag
          const tagLocales = tags.map((t) => t.locale);
          expect(new Set(tagLocales)).toEqual(new Set(availableLocales));

          // Each tag has the correct href format
          for (const tag of tags) {
            expect(tag.href).toBe(`${origin}/${tag.locale}/page/${slug}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no translations produces no hreflang tags", () => {
    fc.assert(
      fc.property(slugArb, originArb, (slug, origin) => {
        const tags = generateHreflangTags([], slug, origin);
        expect(tags).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it("each hreflang tag URL includes the correct locale and slug", () => {
    fc.assert(
      fc.property(
        fc.subarray(SUPPORTED_LOCALES as unknown as Locale[], { minLength: 1, maxLength: 3 }),
        slugArb,
        originArb,
        (locales, slug, origin) => {
          const tags = generateHreflangTags(locales, slug, origin);

          for (const tag of tags) {
            // Verify locale is in the URL path
            expect(tag.href).toContain(`/${tag.locale}/page/`);
            // Verify slug is in the URL path
            expect(tag.href).toContain(`/page/${slug}`);
            // Verify origin is the prefix
            expect(tag.href.startsWith(origin)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("hreflang tags never include locales without translations", () => {
    fc.assert(
      fc.property(
        uniqueTranslationsArb,
        slugArb,
        originArb,
        (translations, slug, origin) => {
          const availableLocales = translations.map((t) => t.locale);
          const tags = generateHreflangTags(availableLocales, slug, origin);

          // Check that no locale appears that isn't in availableLocales
          const tagLocales = new Set(tags.map((t) => t.locale));
          for (const loc of SUPPORTED_LOCALES) {
            if (!availableLocales.includes(loc)) {
              expect(tagLocales.has(loc)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("hreflang tags always include ALL locales that have translations", () => {
    fc.assert(
      fc.property(
        uniqueTranslationsArb,
        slugArb,
        originArb,
        (translations, slug, origin) => {
          const availableLocales = translations.map((t) => t.locale);
          const tags = generateHreflangTags(availableLocales, slug, origin);

          const tagLocales = new Set(tags.map((t) => t.locale));
          for (const loc of availableLocales) {
            expect(tagLocales.has(loc)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
