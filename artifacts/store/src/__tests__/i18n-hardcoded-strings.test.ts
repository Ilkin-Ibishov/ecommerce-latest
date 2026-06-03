/**
 * Bug Condition Exploration Test — Hardcoded Strings Ignore Locale Switch
 *
 * This test verifies that translation keys exist for ALL 15 affected components
 * across all 3 locales (az, ru, en). On unfixed code, these sections do NOT exist
 * in messages.ts, so the test FAILS — confirming the bug.
 *
 * Once the fix is applied (translation keys added to messages.ts), this test will PASS.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15
 */
import { describe, it, expect } from "vitest";
import messages from "@/lib/i18n/messages";

const LOCALES = ["az", "ru", "en"] as const;

/**
 * All 15 component sections that must have translation keys in messages.ts.
 * These correspond to the components with hardcoded strings identified in the bugfix spec.
 */
const REQUIRED_SECTIONS = [
  "Footer",
  "CartDrawer",
  "Header",
  "TrustBadges",
  "ProductDetail",
  "ProductCard",
  "MobileBottomNav",
  "AnnouncementBar",
  "RecentlyViewed",
  "Checkout",
  "Products",
  "Search",
  "Wishlist",
  "Profile",
  "LoginModal",
] as const;

describe("i18n hardcoded strings — bug condition exploration", () => {
  describe("translation sections exist for all affected components", () => {
    for (const section of REQUIRED_SECTIONS) {
      for (const locale of LOCALES) {
        it(`messages.${locale}.${section} exists and has translation keys`, () => {
          const localeMessages = messages[locale];
          expect(localeMessages).toBeDefined();

          const sectionMessages = localeMessages[section];
          expect(
            sectionMessages,
            `Expected messages.${locale}.${section} to be defined, but it is missing. ` +
              `This confirms the bug: component "${section}" has hardcoded strings ` +
              `instead of using t() with translation keys.`,
          ).toBeDefined();

          // Section must be an object with at least one key
          expect(
            typeof sectionMessages,
            `Expected messages.${locale}.${section} to be an object with translation keys`,
          ).toBe("object");

          const keys = Object.keys(sectionMessages as Record<string, unknown>);
          expect(
            keys.length,
            `Expected messages.${locale}.${section} to have at least one translation key`,
          ).toBeGreaterThan(0);
        });
      }
    }
  });

  describe("translation values are strings for all sections", () => {
    for (const section of REQUIRED_SECTIONS) {
      for (const locale of LOCALES) {
        it(`messages.${locale}.${section} values are all strings or nested objects with string leaves`, () => {
          const sectionMessages = messages[locale]?.[section];
          if (!sectionMessages) {
            // If section doesn't exist, the previous test block already catches this.
            // Skip the string-value check here to avoid redundant failures.
            expect(sectionMessages).toBeDefined();
            return;
          }

          function assertStringLeaves(obj: unknown, path: string): void {
            if (typeof obj === "string") return;
            if (typeof obj === "object" && obj !== null) {
              for (const [key, value] of Object.entries(obj)) {
                assertStringLeaves(value, `${path}.${key}`);
              }
              return;
            }
            throw new Error(
              `Expected ${path} to be a string or object, got ${typeof obj}`,
            );
          }

          assertStringLeaves(sectionMessages, `messages.${locale}.${section}`);
        });
      }
    }
  });

  describe("locale-specific translations differ from each other", () => {
    for (const section of REQUIRED_SECTIONS) {
      it(`messages.ru.${section} differs from messages.az.${section} (locale-appropriate text)`, () => {
        const azSection = messages.az?.[section];
        const ruSection = messages.ru?.[section];

        // Both must exist for this check
        expect(azSection, `messages.az.${section} must exist`).toBeDefined();
        expect(ruSection, `messages.ru.${section} must exist`).toBeDefined();

        // The Russian translation should NOT be identical to Azerbaijani
        expect(
          JSON.stringify(ruSection),
          `messages.ru.${section} should differ from messages.az.${section} — ` +
            `if they are identical, the component still shows Azerbaijani text regardless of locale`,
        ).not.toBe(JSON.stringify(azSection));
      });

      it(`messages.en.${section} differs from messages.az.${section} (locale-appropriate text)`, () => {
        const azSection = messages.az?.[section];
        const enSection = messages.en?.[section];

        expect(azSection, `messages.az.${section} must exist`).toBeDefined();
        expect(enSection, `messages.en.${section} must exist`).toBeDefined();

        expect(
          JSON.stringify(enSection),
          `messages.en.${section} should differ from messages.az.${section} — ` +
            `if they are identical, the component still shows Azerbaijani text regardless of locale`,
        ).not.toBe(JSON.stringify(azSection));
      });
    }
  });
});
