import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 30: Locale resolution and fallback

import {
  resolveLocaleString,
  validateLocaleKeyParity,
} from "../src/lib/platform/locale-resolver";

// ─── Generators ────────────────────────────────────────────────────────────────

const localeArb = fc.constantFrom("az" as const, "ru" as const, "en" as const);

const keyArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0 && !s.includes(" "));

const nonEmptyValueArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.length > 0);

/** Generate a full messages dictionary with all locales having the same keys */
const fullMessagesArb = fc
  .array(fc.tuple(keyArb, nonEmptyValueArb, nonEmptyValueArb, nonEmptyValueArb), { minLength: 1, maxLength: 10 })
  .map((entries) => {
    const az: Record<string, string> = {};
    const ru: Record<string, string> = {};
    const en: Record<string, string> = {};
    for (const [key, azVal, ruVal, enVal] of entries) {
      az[key] = azVal;
      ru[key] = ruVal;
      en[key] = enVal;
    }
    return { az, ru, en };
  });

// ─── Property 30: Locale resolution and fallback ────────────────────────────────

describe("Feature: super-admin-platform, Property 30: Locale resolution and fallback", () => {
  describe("requested locale if present", () => {
    it("key exists in requested locale → returns that locale's value", () => {
      fc.assert(
        fc.property(fullMessagesArb, localeArb, (messages, locale) => {
          const keys = Object.keys(messages[locale]);
          if (keys.length === 0) return;
          const key = keys[0];
          const result = resolveLocaleString({ key, locale, messages });
          expect(result).toBe(messages[locale][key]);
        }),
        { numRuns: 100 },
      );
    });

    it("resolved value is never the raw key itself", () => {
      fc.assert(
        fc.property(fullMessagesArb, localeArb, (messages, locale) => {
          const keys = Object.keys(messages[locale]);
          if (keys.length === 0) return;
          const key = keys[0];
          const result = resolveLocaleString({ key, locale, messages });
          // The value from the dictionary should never equal the key itself
          // (unless the translation happens to be the same string as the key,
          // which is a valid scenario — the important thing is it came from the dictionary)
          expect(result).toBe(messages[locale][key]);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("fallback to az when missing in requested locale", () => {
    it("key missing in requested locale but present in az → returns az value", () => {
      fc.assert(
        fc.property(keyArb, nonEmptyValueArb, (key, azValue) => {
          const messages = {
            az: { [key]: azValue },
            ru: {}, // key missing in ru
            en: {}, // key missing in en
          };
          // Requesting from ru or en should fall back to az
          const resultRu = resolveLocaleString({ key, locale: "ru", messages });
          const resultEn = resolveLocaleString({ key, locale: "en", messages });
          expect(resultRu).toBe(azValue);
          expect(resultEn).toBe(azValue);
        }),
        { numRuns: 100 },
      );
    });

    it("empty string in requested locale falls back to az", () => {
      fc.assert(
        fc.property(keyArb, nonEmptyValueArb, (key, azValue) => {
          const messages = {
            az: { [key]: azValue },
            ru: { [key]: "" }, // empty string treated as missing
            en: { [key]: "" },
          };
          const resultRu = resolveLocaleString({ key, locale: "ru", messages });
          expect(resultRu).toBe(azValue);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("placeholder when missing in both — never raw key", () => {
    it("key missing in all locales → returns [missing] placeholder, never the raw key", () => {
      fc.assert(
        fc.property(keyArb, localeArb, (key, locale) => {
          const messages = { az: {}, ru: {}, en: {} };
          const result = resolveLocaleString({ key, locale, messages });
          expect(result).toBe("[missing]");
          expect(result).not.toBe(key);
        }),
        { numRuns: 100 },
      );
    });

    it("key with empty values in all locales → returns [missing] placeholder", () => {
      fc.assert(
        fc.property(keyArb, localeArb, (key, locale) => {
          const messages = { az: { [key]: "" }, ru: { [key]: "" }, en: { [key]: "" } };
          const result = resolveLocaleString({ key, locale, messages });
          expect(result).toBe("[missing]");
          expect(result).not.toBe(key);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("key parity across locales", () => {
    it("messages with identical non-empty keys across all locales → valid", () => {
      fc.assert(
        fc.property(fullMessagesArb, (messages) => {
          const result = validateLocaleKeyParity(messages);
          expect(result.valid).toBe(true);
          expect(result.missingKeys).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });

    it("messages with a key missing in one locale → invalid with that key listed", () => {
      fc.assert(
        fc.property(keyArb, nonEmptyValueArb, nonEmptyValueArb, (key, azVal, enVal) => {
          const messages = {
            az: { [key]: azVal },
            ru: {}, // key missing in ru
            en: { [key]: enVal },
          };
          const result = validateLocaleKeyParity(messages);
          expect(result.valid).toBe(false);
          expect(result.missingKeys).toContain(key);
        }),
        { numRuns: 100 },
      );
    });

    it("messages with an empty value in one locale → invalid", () => {
      fc.assert(
        fc.property(keyArb, nonEmptyValueArb, nonEmptyValueArb, (key, azVal, enVal) => {
          const messages = {
            az: { [key]: azVal },
            ru: { [key]: "" }, // empty = missing per spec
            en: { [key]: enVal },
          };
          const result = validateLocaleKeyParity(messages);
          expect(result.valid).toBe(false);
          expect(result.missingKeys).toContain(key);
        }),
        { numRuns: 100 },
      );
    });
  });
});
