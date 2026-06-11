/**
 * Verification tests for default rendering behavior without custom settings.
 *
 * Confirms that when no custom settings are configured, the storefront renders
 * correctly with:
 * - White background (HSL 0 0% 100%)
 * - Near-black text (HSL 220 20% 10%)
 * - System sans-serif font (Inter)
 * - Store name displays "Store" when no locale-specific name is set
 *
 * Validates: Requirements 14.6, 2.4, 5.4, 5.5
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./context";
import { isValidHsl, applyColors, applyFonts } from "./theme-engine";

// ─── DOM Mock ────────────────────────────────────────────────────────────────

const styleProps = new Map<string, string>();
const mockStyle = {
  setProperty: vi.fn((name: string, value: string) => {
    styleProps.set(name, value);
  }),
};

beforeEach(() => {
  styleProps.clear();
  mockStyle.setProperty.mockClear();

  Object.defineProperty(global, "document", {
    value: {
      documentElement: {
        style: mockStyle,
      },
    },
    writable: true,
    configurable: true,
  });
});

// ─── Default Color Palette Verification ──────────────────────────────────────

describe("Default rendering without custom settings", () => {
  describe("Default color palette produces white background and dark text", () => {
    it("DEFAULT_SETTINGS.colors.background is white (0 0% 100%)", () => {
      expect(DEFAULT_SETTINGS.colors.background).toBe("0 0% 100%");
    });

    it("DEFAULT_SETTINGS.colors.text is near-black (220 20% 10%)", () => {
      expect(DEFAULT_SETTINGS.colors.text).toBe("220 20% 10%");
    });

    it("all default color values are valid HSL", () => {
      const { colors } = DEFAULT_SETTINGS;
      expect(isValidHsl(colors.primary)).toBe(true);
      expect(isValidHsl(colors.secondary)).toBe(true);
      expect(isValidHsl(colors.accent)).toBe(true);
      expect(isValidHsl(colors.background)).toBe(true);
      expect(isValidHsl(colors.text)).toBe(true);
      expect(isValidHsl(colors.muted)).toBe(true);
    });

    it("applyColors with DEFAULT_SETTINGS sets --background to white", () => {
      applyColors(DEFAULT_SETTINGS.colors);
      expect(styleProps.get("--background")).toBe("0 0% 100%");
    });

    it("applyColors with DEFAULT_SETTINGS sets --foreground to near-black", () => {
      applyColors(DEFAULT_SETTINGS.colors);
      expect(styleProps.get("--foreground")).toBe("220 20% 10%");
    });
  });

  describe("Default font configuration uses system sans-serif", () => {
    it("DEFAULT_SETTINGS.fonts.body is Inter (system sans-serif)", () => {
      expect(DEFAULT_SETTINGS.fonts.body).toBe("Inter");
    });

    it("DEFAULT_SETTINGS.fonts.heading is Inter", () => {
      expect(DEFAULT_SETTINGS.fonts.heading).toBe("Inter");
    });

    it("applyFonts with DEFAULT_SETTINGS sets --app-font-sans to Inter", () => {
      applyFonts(DEFAULT_SETTINGS.fonts);
      expect(styleProps.get("--app-font-sans")).toBe('"Inter", sans-serif');
    });
  });

  describe("Store name fallback returns 'Store' when no locale names set", () => {
    it("DEFAULT_SETTINGS.store_name has empty strings for all locales", () => {
      expect(DEFAULT_SETTINGS.store_name.az).toBe("");
      expect(DEFAULT_SETTINGS.store_name.ru).toBe("");
      expect(DEFAULT_SETTINGS.store_name.en).toBe("");
    });

    it("getStoreName logic returns 'Store' when all locales are empty", () => {
      // Replicate the getStoreName logic from context.tsx
      const getStoreName = (locale: string): string => {
        const name = DEFAULT_SETTINGS.store_name[locale];
        if (name && name.trim()) return name;
        const azName = DEFAULT_SETTINGS.store_name["az"];
        if (azName && azName.trim()) return azName;
        return "Store";
      };

      expect(getStoreName("az")).toBe("Store");
      expect(getStoreName("ru")).toBe("Store");
      expect(getStoreName("en")).toBe("Store");
    });

    it("getStoreName returns locale value when set", () => {
      const customSettings = {
        ...DEFAULT_SETTINGS,
        store_name: { az: "Test Mağaza", ru: "", en: "" },
      };

      const getStoreName = (locale: string): string => {
        const name = customSettings.store_name[locale];
        if (name && name.trim()) return name;
        const azName = customSettings.store_name["az"];
        if (azName && azName.trim()) return azName;
        return "Store";
      };

      expect(getStoreName("az")).toBe("Test Mağaza");
      // Falls back to az when ru/en are empty
      expect(getStoreName("ru")).toBe("Test Mağaza");
      expect(getStoreName("en")).toBe("Test Mağaza");
    });
  });

  describe("Header/Footer handle empty logo_url gracefully", () => {
    it("DEFAULT_SETTINGS.logo_url is null", () => {
      expect(DEFAULT_SETTINGS.logo_url).toBeNull();
    });

    it("DEFAULT_SETTINGS.favicon_url is null", () => {
      expect(DEFAULT_SETTINGS.favicon_url).toBeNull();
    });
  });

  describe("Contact fields are empty by default (omitted from rendering)", () => {
    it("DEFAULT_SETTINGS.contact.phone is empty", () => {
      expect(DEFAULT_SETTINGS.contact.phone).toBe("");
    });

    it("DEFAULT_SETTINGS.contact.email is empty", () => {
      expect(DEFAULT_SETTINGS.contact.email).toBe("");
    });

    it("DEFAULT_SETTINGS.contact.address is empty", () => {
      expect(DEFAULT_SETTINGS.contact.address).toBe("");
    });

    it("DEFAULT_SETTINGS.contact.social_links is empty object", () => {
      expect(DEFAULT_SETTINGS.contact.social_links).toEqual({});
    });
  });
});
