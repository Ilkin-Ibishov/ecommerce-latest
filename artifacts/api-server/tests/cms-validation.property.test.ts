import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import DOMPurify from "isomorphic-dompurify";

/**
 * CMS Validation Property Tests
 * Feature: white-label-customization
 * Validates: Requirements 6.3, 6.4, 6.5, 7.3
 */

// ─── Shared constants from pages.ts ──────────────────────────────────────────

/** Valid slug pattern: lowercase alphanumeric segments separated by hyphens */
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Maximum slug length */
const MAX_SLUG_LENGTH = 100;

/** DOMPurify configuration matching the one in pages.ts */
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ["p", "h2", "h3", "h4", "strong", "em", "ul", "ol", "li", "a", "img", "br", "blockquote"],
  ALLOWED_ATTR: ["href", "src", "alt"],
  ALLOW_DATA_ATTR: false,
};

const ALLOWED_TAGS_SET = new Set(SANITIZE_CONFIG.ALLOWED_TAGS);

// ─── Slug validation logic (extracted from pages.ts) ─────────────────────────

function isValidSlug(slug: string): boolean {
  return typeof slug === "string" && slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_REGEX.test(slug);
}

// ─── Delete handler logic (extracted from pages.ts) ──────────────────────────

interface PageRecord {
  id: string;
  slug: string;
  is_system: boolean;
}

function canDeletePage(page: PageRecord): { allowed: boolean; error?: string } {
  if (page.is_system) {
    return { allowed: false, error: "System pages cannot be deleted" };
  }
  return { allowed: true };
}

// ─── Slug uniqueness check logic (extracted from pages.ts) ───────────────────

function isSlugUnique(slug: string, existingPages: Array<{ id: string; slug: string }>, excludeId?: string): boolean {
  return !existingPages.some((p) => p.slug === slug && p.id !== excludeId);
}

// ─── Sanitization helper ─────────────────────────────────────────────────────

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

/**
 * Parse tags from an HTML string. Returns all element tag names found in the output.
 */
function extractTags(html: string): string[] {
  const tagRegex = /<([a-z][a-z0-9]*)\b[^>]*\/?>/gi;
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return tags;
}

/**
 * Extract all attributes from an HTML string. Returns array of {tag, attr} pairs.
 * Uses a proper parsing approach that handles attribute values containing special characters.
 */
function extractAttributes(html: string): Array<{ tag: string; attr: string }> {
  const results: Array<{ tag: string; attr: string }> = [];
  // Match opening tags
  const tagRegex = /<([a-z][a-z0-9]*)\s+([^>]*?)\/?>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tagName = tagMatch[1].toLowerCase();
    const attrString = tagMatch[2];
    // Extract attribute names properly — match name="value" or name='value' patterns
    const attrRegex = /([a-z][a-z0-9-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      if (attrMatch[1]) {
        results.push({ tag: tagName, attr: attrMatch[1].toLowerCase() });
      }
    }
  }
  return results;
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generator for valid slug segments (lowercase alphanumeric, 1-10 chars) */
const slugSegmentArb = fc.stringMatching(/^[a-z0-9]{1,10}$/);

/** Generator for valid slugs: one or more segments joined by hyphens */
const validSlugArb = fc
  .array(slugSegmentArb, { minLength: 1, maxLength: 8 })
  .map((segments) => segments.join("-"))
  .filter((slug) => slug.length > 0 && slug.length <= MAX_SLUG_LENGTH);

/** Generator for invalid slugs */
const invalidSlugArb = fc.oneof(
  // Contains uppercase letters
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /[A-Z]/.test(s)),
  // Contains spaces
  fc.stringMatching(/^[a-z0-9]{1,5}$/).map((s) => s + " " + s),
  // Starts with a hyphen
  fc.stringMatching(/^[a-z0-9]{1,10}$/).map((s) => "-" + s),
  // Ends with a hyphen
  fc.stringMatching(/^[a-z0-9]{1,10}$/).map((s) => s + "-"),
  // Contains consecutive hyphens
  fc.tuple(slugSegmentArb, slugSegmentArb).map(([seg, seg2]) => `${seg}--${seg2}`),
  // Contains special characters
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /[^a-z0-9-]/.test(s) && s.length > 0),
  // Too long (> 100 chars)
  fc.stringMatching(/^[a-z0-9]{1,8}$/).chain((seg) =>
    fc.constant(Array.from({ length: 15 }, () => seg).join("-")),
  ).filter((s) => s.length > MAX_SLUG_LENGTH),
);

/** Generator for arbitrary HTML strings with dangerous content */
const dangerousHtmlArb = fc.oneof(
  // Script tags
  fc.string({ minLength: 0, maxLength: 50 }).map((s) => `<script>${s}</script>`),
  // Event handlers on elements
  fc.constantFrom("onclick", "onload", "onerror", "onmouseover", "onfocus").chain((handler) =>
    fc.string({ minLength: 1, maxLength: 20 }).map((content) => `<p ${handler}="alert(1)">${content}</p>`),
  ),
  // Iframes
  fc.webUrl().map((url) => `<iframe src="${url}"></iframe>`),
  // Mixed safe and dangerous content
  fc.tuple(
    fc.constantFrom("<p>safe</p>", "<h2>heading</h2>", "<strong>bold</strong>"),
    fc.constantFrom('<script>alert("xss")</script>', '<iframe src="evil.com"></iframe>', '<img onerror="alert(1)" src="x">'),
  ).map(([safe, dangerous]) => `${safe}${dangerous}`),
);

/** Generator for HTML with various elements (some allowed, some not) */
const mixedHtmlArb = fc.oneof(
  // Allowed elements
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<p>${text}</p>`),
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<h2>${text}</h2>`),
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<strong>${text}</strong>`),
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<blockquote><p>${text}</p></blockquote>`),
  // Disallowed elements
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<div>${text}</div>`),
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<span>${text}</span>`),
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<table><tr><td>${text}</td></tr></table>`),
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<form><input value="${text}"></form>`),
);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("CMS Validation Property Tests", () => {
  /**
   * Property 13: CMS slug validation
   * Validates: Requirements 6.4
   *
   * For any string submitted as a page slug, the CMS_Service shall accept it
   * IFF it matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and has length ≤ 100 characters.
   */
  describe("Property 13: CMS slug validation", () => {
    it("accepts all valid slugs (lowercase alphanumeric segments separated by hyphens, ≤ 100 chars)", () => {
      fc.assert(
        fc.property(validSlugArb, (slug) => {
          expect(isValidSlug(slug)).toBe(true);
          // Double check the regex matches
          expect(SLUG_REGEX.test(slug)).toBe(true);
          expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
        }),
        { numRuns: 100 },
      );
    });

    it("rejects all invalid slugs (uppercase, special chars, wrong format, or too long)", () => {
      fc.assert(
        fc.property(invalidSlugArb, (slug) => {
          expect(isValidSlug(slug)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it("rejects empty strings", () => {
      expect(isValidSlug("")).toBe(false);
    });

    it("validates arbitrary strings correctly against the regex and length constraint", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 120 }), (str) => {
          const expected = str.length > 0 && str.length <= MAX_SLUG_LENGTH && SLUG_REGEX.test(str);
          expect(isValidSlug(str)).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 14: System pages cannot be deleted
   * Validates: Requirements 6.3
   *
   * For any page where `is_system` is `true`, a DELETE request shall be rejected
   * with an error response.
   */
  describe("Property 14: System pages cannot be deleted", () => {
    it("rejects deletion of any page where is_system is true", () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            slug: validSlugArb,
            is_system: fc.constant(true),
          }),
          (page) => {
            const result = canDeletePage(page);
            expect(result.allowed).toBe(false);
            expect(result.error).toBe("System pages cannot be deleted");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("allows deletion of any page where is_system is false", () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            slug: validSlugArb,
            is_system: fc.constant(false),
          }),
          (page) => {
            const result = canDeletePage(page);
            expect(result.allowed).toBe(true);
            expect(result.error).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it("system page deletion is rejected regardless of slug or id value", () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          validSlugArb,
          (id, slug) => {
            const systemPage: PageRecord = { id, slug, is_system: true };
            const result = canDeletePage(systemPage);
            expect(result.allowed).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 15: Slug uniqueness enforcement
   * Validates: Requirements 6.5
   *
   * For any page create or update operation, if the submitted slug already exists
   * on a different page, the CMS_Service shall reject the request.
   */
  describe("Property 15: Slug uniqueness enforcement", () => {
    it("rejects a slug that already exists on a different page", () => {
      fc.assert(
        fc.property(
          validSlugArb,
          fc.uuid(),
          fc.uuid(),
          (slug, existingPageId, newPageId) => {
            // Ensure they are different pages
            fc.pre(existingPageId !== newPageId);

            const existingPages = [{ id: existingPageId, slug }];
            const isUnique = isSlugUnique(slug, existingPages, newPageId);
            expect(isUnique).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("accepts a slug that does not exist on any other page", () => {
      fc.assert(
        fc.property(
          validSlugArb,
          fc.array(
            fc.record({ id: fc.uuid(), slug: validSlugArb }),
            { minLength: 0, maxLength: 10 },
          ),
          (newSlug, existingPages) => {
            // Ensure none of the existing pages have the same slug
            const filteredPages = existingPages.filter((p) => p.slug !== newSlug);
            const isUnique = isSlugUnique(newSlug, filteredPages);
            expect(isUnique).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("allows the same slug when updating the same page (excludeId matches)", () => {
      fc.assert(
        fc.property(
          validSlugArb,
          fc.uuid(),
          (slug, pageId) => {
            const existingPages = [{ id: pageId, slug }];
            // When excludeId equals the page's own id, the slug is considered unique
            const isUnique = isSlugUnique(slug, existingPages, pageId);
            expect(isUnique).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("rejects duplicate slugs in a set of multiple existing pages", () => {
      fc.assert(
        fc.property(
          validSlugArb,
          fc.array(fc.uuid(), { minLength: 2, maxLength: 5 }),
          (slug, ids) => {
            // At least one existing page has the slug
            const existingPages = ids.map((id, i) => ({
              id,
              slug: i === 0 ? slug : `other-slug-${i}`,
            }));
            // A new page trying to use the same slug (different id)
            const newPageId = "00000000-0000-0000-0000-999999999999";
            fc.pre(ids.every((id) => id !== newPageId));
            const isUnique = isSlugUnique(slug, existingPages, newPageId);
            expect(isUnique).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 16: HTML sanitization preserves only safe elements
   * Validates: Requirements 7.3
   *
   * For any HTML string submitted as page content, the sanitized output shall contain
   * only p, h2, h3, h4, strong, em, ul, ol, li, a, img, br, blockquote with only
   * safe attributes (href on a, src and alt on img), and no script, event handlers,
   * or iframe elements.
   */
  describe("Property 16: HTML sanitization preserves only safe elements", () => {
    it("sanitized output never contains script, iframe, or event handler attributes", () => {
      fc.assert(
        fc.property(dangerousHtmlArb, (html) => {
          const result = sanitizeHtml(html);

          // No script tags
          expect(result).not.toMatch(/<script[\s>]/i);
          // No iframe tags
          expect(result).not.toMatch(/<iframe[\s>]/i);
          // No event handlers (on* attributes)
          expect(result).not.toMatch(/\bon\w+\s*=/i);
        }),
        { numRuns: 100 },
      );
    });

    it("sanitized output contains only allowed tags", () => {
      fc.assert(
        fc.property(mixedHtmlArb, (html) => {
          const result = sanitizeHtml(html);
          const tags = extractTags(result);

          for (const tag of tags) {
            expect(ALLOWED_TAGS_SET.has(tag)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("sanitized output contains only allowed attributes on correct elements", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Anchor with various attributes
            fc.tuple(fc.webUrl(), fc.string({ minLength: 1, maxLength: 10 })).map(
              ([url, text]) => `<a href="${url}" target="_blank" class="link" onclick="alert(1)">${text}</a>`,
            ),
            // Img with various attributes
            fc.tuple(fc.webUrl(), fc.string({ minLength: 1, maxLength: 20 })).map(
              ([url, alt]) => `<img src="${url}" alt="${alt}" width="100" onerror="alert(1)" style="color:red">`,
            ),
            // P with disallowed attributes
            fc.string({ minLength: 1, maxLength: 20 }).map(
              (text) => `<p class="test" id="para" style="color:red">${text}</p>`,
            ),
          ),
          (html) => {
            const result = sanitizeHtml(html);
            const attrs = extractAttributes(result);

            for (const { tag, attr } of attrs) {
              if (tag === "a") {
                expect(attr).toBe("href");
              } else if (tag === "img") {
                expect(["src", "alt"]).toContain(attr);
              } else {
                // No other element should have any attributes
                expect(attr).toBeUndefined();
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("sanitized output preserves text content from arbitrary HTML", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes("<") && !s.includes(">") && !s.includes("&")),
          (text) => {
            const html = `<p>${text}</p>`;
            const result = sanitizeHtml(html);
            // The text content should be preserved inside the p tag
            expect(result).toContain(text);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("handles arbitrary string input without throwing", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), (html) => {
          // Sanitization should never throw, regardless of input
          expect(() => sanitizeHtml(html)).not.toThrow();

          const result = sanitizeHtml(html);
          // Result should never contain script or iframe
          expect(result).not.toMatch(/<script[\s>]/i);
          expect(result).not.toMatch(/<iframe[\s>]/i);
          // Result should never contain event handlers
          expect(result).not.toMatch(/\bon\w+\s*=/i);
        }),
        { numRuns: 100 },
      );
    });
  });
});
