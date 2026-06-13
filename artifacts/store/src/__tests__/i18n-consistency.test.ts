/**
 * i18n Consistency Tests
 *
 * Verifies structural consistency across all locale message objects:
 * - All locales have the same key paths
 * - No locale is missing keys that others have
 * - Free delivery threshold is consistent across components
 * - No empty string translations (except intentionally empty ones)
 */
import { describe, it, expect } from "vitest";
import messages from "@/lib/i18n/messages";

const LOCALES = ["az", "ru", "en"] as const;

/** Recursively collect all dot-separated key paths from a nested object */
function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/** Get value at a dot-separated path from a nested object */
function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

describe("i18n Consistency", () => {
  const azKeys = collectKeys(messages.az as Record<string, unknown>);
  const ruKeys = collectKeys(messages.ru as Record<string, unknown>);
  const enKeys = collectKeys(messages.en as Record<string, unknown>);

  describe("all locales have identical key structure", () => {
    it("az and ru have the same keys", () => {
      const missingInRu = azKeys.filter((k) => !ruKeys.includes(k));
      const extraInRu = ruKeys.filter((k) => !azKeys.includes(k));

      expect(missingInRu).toEqual([]);
      expect(extraInRu).toEqual([]);
    });

    it("az and en have the same keys", () => {
      const missingInEn = azKeys.filter((k) => !enKeys.includes(k));
      const extraInEn = enKeys.filter((k) => !azKeys.includes(k));

      expect(missingInEn).toEqual([]);
      expect(extraInEn).toEqual([]);
    });
  });

  describe("no empty string values", () => {
    for (const locale of LOCALES) {
      it(`${locale}: no translation value is an empty string`, () => {
        const keys = collectKeys(messages[locale] as Record<string, unknown>);
        const emptyKeys: string[] = [];

        for (const key of keys) {
          const value = getAtPath(messages[locale] as Record<string, unknown>, key);
          if (value === "") {
            emptyKeys.push(key);
          }
        }

        expect(emptyKeys).toEqual([]);
      });
    }
  });

  describe("free delivery threshold consistency", () => {
    it("all freeDelivery references mention 100 AZN consistently", () => {
      for (const locale of LOCALES) {
        const msgs = messages[locale] as Record<string, unknown>;

        // Check TrustBadges subtitle
        const trustSubtitle = getAtPath(msgs, "TrustBadges.freeDeliverySubtitle") as string;
        expect(trustSubtitle).toMatch(/100/);

        // Check ProductDetail.freeDeliveryOver
        const productDetail = getAtPath(msgs, "ProductDetail.freeDeliveryOver") as string;
        expect(productDetail).toMatch(/100/);
        expect(productDetail).not.toMatch(/50/);

        // Check AnnouncementBar.message
        const announcement = getAtPath(msgs, "AnnouncementBar.message") as string;
        expect(announcement).toMatch(/100/);
      }
    });
  });

  describe("ProductPage i18n keys exist", () => {
    for (const locale of LOCALES) {
      it(`${locale}: ProductPage.notFound and ProductPage.notFoundBack exist and are non-empty`, () => {
        const msgs = messages[locale] as Record<string, unknown>;

        const notFound = getAtPath(msgs, "ProductPage.notFound");
        const notFoundBack = getAtPath(msgs, "ProductPage.notFoundBack");

        expect(notFound).toBeDefined();
        expect(typeof notFound).toBe("string");
        expect((notFound as string).length).toBeGreaterThan(0);

        expect(notFoundBack).toBeDefined();
        expect(typeof notFoundBack).toBe("string");
        expect((notFoundBack as string).length).toBeGreaterThan(0);
      });
    }
  });

  describe("critical section completeness", () => {
    const criticalSections = [
      "Header",
      "Footer",
      "CartDrawer",
      "Checkout",
      "ProductDetail",
      "Categories",
      "ProductPage",
    ];

    for (const section of criticalSections) {
      it(`all locales have ${section} section`, () => {
        for (const locale of LOCALES) {
          const msgs = messages[locale] as Record<string, unknown>;
          const sectionData = getAtPath(msgs, section);
          expect(sectionData).toBeDefined();
          expect(typeof sectionData).toBe("object");
        }
      });
    }
  });
});
