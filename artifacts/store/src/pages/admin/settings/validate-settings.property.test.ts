/**
 * Property-based test for client-side settings validation.
 *
 * Feature: white-label-customization, Property 21: Client-side settings validation
 *
 * Property 21: For any admin settings form submission, the client SHALL reject values
 * where: email does not match standard email format, URLs do not start with `https://`,
 * phone contains characters other than digits and `+`, or text fields exceed their
 * maximum character limits.
 *
 * **Validates: Requirements 11.7**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateSettings, FIELD_LIMITS } from "./validate-settings";
import { DEFAULT_SETTINGS } from "@/lib/settings/context";
import type { SiteSettings } from "@/lib/settings/context";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a settings object with specific overrides applied to the defaults */
function makeSettings(overrides: Partial<SiteSettings>): SiteSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Helper: build a string from an array of characters (fast-check v4 compatible) */
function stringFromChars(chars: string, opts: { minLength: number; maxLength: number }): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...chars.split('')), { minLength: opts.minLength, maxLength: opts.maxLength })
    .map((arr) => arr.join(''));
}

const ALPHA_NUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

/** Generates a valid email: local@domain.tld */
const validEmail = fc
  .tuple(
    stringFromChars(ALPHA_NUM, { minLength: 1, maxLength: 20 }),
    stringFromChars(ALPHA_NUM, { minLength: 1, maxLength: 15 }),
    stringFromChars(ALPHA, { minLength: 2, maxLength: 4 })
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Generates an invalid email (missing @, missing domain, only spaces, etc.) */
const invalidEmail = fc.oneof(
  // No @ sign
  stringFromChars(ALPHA_NUM, { minLength: 1, maxLength: 30 }),
  // @ but no domain part after dot
  stringFromChars(ALPHA, { minLength: 1, maxLength: 10 })
    .map((local) => `${local}@`),
  // Just whitespace
  fc.constant("   "),
  // Missing local part
  stringFromChars(ALPHA, { minLength: 2, maxLength: 10 })
    .map((domain) => `@${domain}.com`),
  // Double @
  fc.tuple(
    stringFromChars(ALPHA, { minLength: 1, maxLength: 5 }),
    stringFromChars(ALPHA, { minLength: 1, maxLength: 5 })
  ).map(([a, b]) => `${a}@@${b}.com`)
);

/** Generates a valid URL starting with https:// */
const validHttpsUrl = stringFromChars(ALPHA_NUM + '-', { minLength: 3, maxLength: 30 })
  .map((domain) => `https://${domain}.com`);

/** Generates a URL NOT starting with https:// */
const invalidUrl = fc.oneof(
  // http:// instead of https://
  stringFromChars(ALPHA_NUM, { minLength: 3, maxLength: 20 })
    .map((d) => `http://${d}.com`),
  // ftp://
  stringFromChars(ALPHA, { minLength: 3, maxLength: 10 })
    .map((d) => `ftp://${d}.com`),
  // No protocol
  stringFromChars(ALPHA, { minLength: 3, maxLength: 15 })
    .map((d) => `${d}.com`),
  // Just a word
  stringFromChars(ALPHA, { minLength: 3, maxLength: 20 })
);

/** Generates a valid phone number (digits and + only) */
const validPhone = fc
  .tuple(
    fc.boolean(),
    stringFromChars(DIGITS, { minLength: 5, maxLength: 15 })
  )
  .map(([hasPlus, digits]) => hasPlus ? `+${digits}` : digits);

/** Generates a phone number with invalid characters (not digits or +) */
const invalidPhone = fc.oneof(
  // Contains letters
  fc.tuple(
    stringFromChars(DIGITS, { minLength: 1, maxLength: 5 }),
    stringFromChars(ALPHA, { minLength: 1, maxLength: 5 }),
    stringFromChars(DIGITS, { minLength: 1, maxLength: 5 })
  ).map(([a, b, c]) => `${a}${b}${c}`),
  // Contains parentheses or dashes
  fc.tuple(
    stringFromChars(DIGITS, { minLength: 3, maxLength: 5 }),
    stringFromChars(DIGITS, { minLength: 3, maxLength: 5 })
  ).map(([a, b]) => `(${a}) ${b}`),
  // Contains special characters
  fc.tuple(
    stringFromChars(DIGITS, { minLength: 3, maxLength: 6 }),
    fc.constantFrom('-', '.', '/', '#', '*')
  ).map(([digits, sep]) => `${digits.slice(0, 3)}${sep}${digits.slice(3)}`)
);

/** Generates a string exceeding the given max length */
function stringExceedingLimit(maxLength: number): fc.Arbitrary<string> {
  return stringFromChars(ALPHA_NUM + ' ', { minLength: maxLength + 1, maxLength: maxLength + 50 });
}

/** Generates a string within the given max length */
function stringWithinLimit(maxLength: number): fc.Arbitrary<string> {
  return stringFromChars(ALPHA_NUM + ' ', { minLength: 1, maxLength: Math.min(maxLength, 50) });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: white-label-customization, Property 21: Client-side settings validation", () => {
  describe("Email validation", () => {
    it("accepts valid email addresses", () => {
      fc.assert(
        fc.property(validEmail, (email) => {
          const settings = makeSettings({
            contact: { ...DEFAULT_SETTINGS.contact, email, social_links: {} },
          });
          const errors = validateSettings(settings);
          expect(errors.email).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it("rejects invalid email addresses", () => {
      fc.assert(
        fc.property(invalidEmail, (email) => {
          const settings = makeSettings({
            contact: { ...DEFAULT_SETTINGS.contact, email, social_links: {} },
          });
          const errors = validateSettings(settings);
          expect(errors.email).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("URL validation (social links must start with https://)", () => {
    it("accepts URLs starting with https://", () => {
      fc.assert(
        fc.property(
          validHttpsUrl,
          fc.constantFrom("instagram", "facebook", "telegram") as fc.Arbitrary<"instagram" | "facebook" | "telegram">,
          (url, platform) => {
            const settings = makeSettings({
              contact: {
                ...DEFAULT_SETTINGS.contact,
                social_links: { [platform]: url },
              },
            });
            const errors = validateSettings(settings);
            expect(errors[`social_${platform}`]).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects URLs that do not start with https://", () => {
      fc.assert(
        fc.property(
          invalidUrl,
          fc.constantFrom("instagram", "facebook", "telegram") as fc.Arbitrary<"instagram" | "facebook" | "telegram">,
          (url, platform) => {
            const settings = makeSettings({
              contact: {
                ...DEFAULT_SETTINGS.contact,
                social_links: { [platform]: url },
              },
            });
            const errors = validateSettings(settings);
            expect(errors[`social_${platform}`]).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Phone validation (digits and + only)", () => {
    it("accepts phone numbers with only digits and +", () => {
      fc.assert(
        fc.property(validPhone, (phone) => {
          const settings = makeSettings({
            contact: { ...DEFAULT_SETTINGS.contact, phone, social_links: {} },
          });
          const errors = validateSettings(settings);
          expect(errors.phone).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it("rejects phone numbers with characters other than digits and +", () => {
      fc.assert(
        fc.property(invalidPhone, (phone) => {
          const settings = makeSettings({
            contact: { ...DEFAULT_SETTINGS.contact, phone, social_links: {} },
          });
          const errors = validateSettings(settings);
          expect(errors.phone).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("Text field character limits", () => {
    it("rejects store names exceeding maximum length", () => {
      fc.assert(
        fc.property(
          stringExceedingLimit(FIELD_LIMITS.storeNameMax),
          fc.constantFrom("az", "ru", "en"),
          (name, locale) => {
            const settings = makeSettings({
              store_name: { ...DEFAULT_SETTINGS.store_name, [locale]: name },
            });
            const errors = validateSettings(settings);
            expect(errors[`store_name_${locale}`]).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("accepts store names within maximum length", () => {
      fc.assert(
        fc.property(
          stringWithinLimit(FIELD_LIMITS.storeNameMax),
          fc.constantFrom("az", "ru", "en"),
          (name, locale) => {
            const settings = makeSettings({
              store_name: { ...DEFAULT_SETTINGS.store_name, [locale]: name },
            });
            const errors = validateSettings(settings);
            expect(errors[`store_name_${locale}`]).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects phone exceeding maximum length", () => {
      fc.assert(
        fc.property(
          // Generate a string of only digits exceeding the phone max length
          stringFromChars(DIGITS, {
            minLength: FIELD_LIMITS.phoneMax + 1,
            maxLength: FIELD_LIMITS.phoneMax + 30,
          }),
          (phone) => {
            const settings = makeSettings({
              contact: { ...DEFAULT_SETTINGS.contact, phone, social_links: {} },
            });
            const errors = validateSettings(settings);
            expect(errors.phone).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects email exceeding maximum length", () => {
      fc.assert(
        fc.property(
          // Generate a valid-format email that exceeds max length
          stringFromChars(ALPHA_NUM, {
            minLength: FIELD_LIMITS.emailMax,
            maxLength: FIELD_LIMITS.emailMax + 30,
          }).map((local) => `${local}@test.com`),
          (email) => {
            const settings = makeSettings({
              contact: { ...DEFAULT_SETTINGS.contact, email, social_links: {} },
            });
            const errors = validateSettings(settings);
            expect(errors.email).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects address exceeding maximum length", () => {
      fc.assert(
        fc.property(
          stringExceedingLimit(FIELD_LIMITS.addressMax),
          (address) => {
            const settings = makeSettings({
              contact: { ...DEFAULT_SETTINGS.contact, address, social_links: {} },
            });
            const errors = validateSettings(settings);
            expect(errors.address).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects social link URLs exceeding maximum length", () => {
      fc.assert(
        fc.property(
          // Generate a URL that starts with https:// but exceeds max length
          stringFromChars(ALPHA_NUM, {
            minLength: FIELD_LIMITS.socialLinkMax - 8,
            maxLength: FIELD_LIMITS.socialLinkMax + 20,
          }).map((path) => `https://${path}`),
          fc.constantFrom("instagram", "facebook", "telegram") as fc.Arbitrary<"instagram" | "facebook" | "telegram">,
          (url, platform) => {
            // Ensure the URL actually exceeds the limit
            fc.pre(url.length > FIELD_LIMITS.socialLinkMax);
            const settings = makeSettings({
              contact: {
                ...DEFAULT_SETTINGS.contact,
                social_links: { [platform]: url },
              },
            });
            const errors = validateSettings(settings);
            expect(errors[`social_${platform}`]).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects working hours exceeding maximum length", () => {
      fc.assert(
        fc.property(
          stringExceedingLimit(FIELD_LIMITS.workingHoursMax),
          fc.constantFrom("az", "ru", "en"),
          (hours, locale) => {
            const settings = makeSettings({
              working_hours: { ...DEFAULT_SETTINGS.working_hours, [locale]: hours },
            });
            const errors = validateSettings(settings);
            expect(errors[`working_hours_${locale}`]).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects footer text exceeding maximum length", () => {
      fc.assert(
        fc.property(
          stringExceedingLimit(FIELD_LIMITS.footerTextMax),
          fc.constantFrom("az", "ru", "en"),
          (text, locale) => {
            const settings = makeSettings({
              footer_text: { ...DEFAULT_SETTINGS.footer_text, [locale]: text },
            });
            const errors = validateSettings(settings);
            expect(errors[`footer_text_${locale}`]).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
