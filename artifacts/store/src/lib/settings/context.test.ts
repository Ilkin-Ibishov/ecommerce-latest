import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  STALE_THRESHOLD_MS,
  EXPIRY_THRESHOLD_MS,
  getCacheTimestamp,
  getCacheAgeMs,
  isCacheStale,
  isCacheExpired,
} from "./context";

// ─── localStorage mock ───────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("stale-while-revalidate cache helpers", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCacheTimestamp", () => {
    it("returns null when no cache timestamp exists", () => {
      expect(getCacheTimestamp()).toBeNull();
    });

    it("returns the stored timestamp as a number", () => {
      const now = Date.now();
      localStorageMock.setItem("site_settings_cached_at", now.toString());
      expect(getCacheTimestamp()).toBe(now);
    });

    it("returns null for invalid timestamp", () => {
      localStorageMock.setItem("site_settings_cached_at", "not-a-number");
      expect(getCacheTimestamp()).toBeNull();
    });
  });

  describe("getCacheAgeMs", () => {
    it("returns null when no cache exists", () => {
      expect(getCacheAgeMs()).toBeNull();
    });

    it("returns the time elapsed since cache was stored", () => {
      const now = 1700000000000;
      vi.setSystemTime(now);
      localStorageMock.setItem("site_settings_cached_at", now.toString());

      // Advance time by 2 minutes
      vi.setSystemTime(now + 120_000);
      expect(getCacheAgeMs()).toBe(120_000);
    });
  });

  describe("isCacheStale", () => {
    it("returns true when no cache exists", () => {
      expect(isCacheStale()).toBe(true);
    });

    it("returns false when cache is younger than 5 minutes", () => {
      const now = 1700000000000;
      vi.setSystemTime(now);
      localStorageMock.setItem("site_settings_cached_at", now.toString());

      // 4 minutes later
      vi.setSystemTime(now + 4 * 60 * 1000);
      expect(isCacheStale()).toBe(false);
    });

    it("returns false when cache is exactly 5 minutes old (boundary)", () => {
      const now = 1700000000000;
      vi.setSystemTime(now);
      localStorageMock.setItem("site_settings_cached_at", now.toString());

      // Exactly at the boundary — not yet over
      vi.setSystemTime(now + STALE_THRESHOLD_MS);
      expect(isCacheStale()).toBe(false);
    });

    it("returns true when cache is older than 5 minutes", () => {
      const now = 1700000000000;
      vi.setSystemTime(now);
      localStorageMock.setItem("site_settings_cached_at", now.toString());

      // 6 minutes later
      vi.setSystemTime(now + 6 * 60 * 1000);
      expect(isCacheStale()).toBe(true);
    });
  });

  describe("isCacheExpired", () => {
    it("returns true when no cache exists", () => {
      expect(isCacheExpired()).toBe(true);
    });

    it("returns false when cache is younger than 24 hours", () => {
      const now = 1700000000000;
      vi.setSystemTime(now);
      localStorageMock.setItem("site_settings_cached_at", now.toString());

      // 23 hours later
      vi.setSystemTime(now + 23 * 60 * 60 * 1000);
      expect(isCacheExpired()).toBe(false);
    });

    it("returns false when cache is exactly 24 hours old (boundary)", () => {
      const now = 1700000000000;
      vi.setSystemTime(now);
      localStorageMock.setItem("site_settings_cached_at", now.toString());

      // Exactly at the boundary — not yet over
      vi.setSystemTime(now + EXPIRY_THRESHOLD_MS);
      expect(isCacheExpired()).toBe(false);
    });

    it("returns true when cache is older than 24 hours", () => {
      const now = 1700000000000;
      vi.setSystemTime(now);
      localStorageMock.setItem("site_settings_cached_at", now.toString());

      // 25 hours later
      vi.setSystemTime(now + 25 * 60 * 60 * 1000);
      expect(isCacheExpired()).toBe(true);
    });
  });

  describe("DEFAULT_SETTINGS", () => {
    it("has white background color (0 0% 100%)", () => {
      expect(DEFAULT_SETTINGS.colors.background).toBe("0 0% 100%");
    });

    it("has dark text color (220 20% 10%)", () => {
      expect(DEFAULT_SETTINGS.colors.text).toBe("220 20% 10%");
    });

    it("has Inter as the default body font (system sans-serif)", () => {
      expect(DEFAULT_SETTINGS.fonts.body).toBe("Inter");
    });

    it("has Inter as the default heading font", () => {
      expect(DEFAULT_SETTINGS.fonts.heading).toBe("Inter");
    });

    it("has empty updated_at (signals no cache)", () => {
      expect(DEFAULT_SETTINGS.updated_at).toBe("");
    });
  });

  describe("STALE_THRESHOLD_MS and EXPIRY_THRESHOLD_MS constants", () => {
    it("STALE_THRESHOLD_MS is 5 minutes in milliseconds", () => {
      expect(STALE_THRESHOLD_MS).toBe(300_000);
    });

    it("EXPIRY_THRESHOLD_MS is 24 hours in milliseconds", () => {
      expect(EXPIRY_THRESHOLD_MS).toBe(86_400_000);
    });
  });
});

// ─── Default Rendering Verification (Requirement 14.6) ──────────────────────

describe("default rendering without custom settings", () => {
  describe("DEFAULT_SETTINGS produces correct visual defaults", () => {
    it("background color maps to white (HSL 0 0% 100%)", () => {
      // "0 0% 100%" == hsl(0, 0%, 100%) == #FFFFFF == white
      expect(DEFAULT_SETTINGS.colors.background).toBe("0 0% 100%");
    });

    it("text color maps to near-black (HSL 220 20% 10%)", () => {
      // "220 20% 10%" is a very dark blue-gray, effectively black text
      expect(DEFAULT_SETTINGS.colors.text).toBe("220 20% 10%");
    });

    it("fonts default to Inter (system sans-serif)", () => {
      expect(DEFAULT_SETTINGS.fonts.body).toBe("Inter");
      expect(DEFAULT_SETTINGS.fonts.heading).toBe("Inter");
    });

    it("logo_url is null (no logo configured)", () => {
      expect(DEFAULT_SETTINGS.logo_url).toBeNull();
    });

    it("favicon_url is null (no favicon configured)", () => {
      expect(DEFAULT_SETTINGS.favicon_url).toBeNull();
    });

    it("all contact fields are empty strings", () => {
      expect(DEFAULT_SETTINGS.contact.phone).toBe("");
      expect(DEFAULT_SETTINGS.contact.email).toBe("");
      expect(DEFAULT_SETTINGS.contact.address).toBe("");
    });

    it("social_links is an empty object", () => {
      expect(DEFAULT_SETTINGS.contact.social_links).toEqual({});
    });
  });

  describe("getStoreName fallback logic", () => {
    // Simulate the getStoreName logic directly (same as in context.tsx)
    function getStoreName(storeNameObj: Record<string, string>, locale: string): string {
      const name = storeNameObj[locale];
      if (name && name.trim()) return name;
      const azName = storeNameObj["az"];
      if (azName && azName.trim()) return azName;
      return "Store";
    }

    it("returns 'Store' when all locale values are empty strings", () => {
      const storeNames = { az: "", ru: "", en: "" };
      expect(getStoreName(storeNames, "az")).toBe("Store");
      expect(getStoreName(storeNames, "ru")).toBe("Store");
      expect(getStoreName(storeNames, "en")).toBe("Store");
    });

    it("returns 'Store' when store_name matches DEFAULT_SETTINGS", () => {
      expect(getStoreName(DEFAULT_SETTINGS.store_name, "az")).toBe("Store");
      expect(getStoreName(DEFAULT_SETTINGS.store_name, "ru")).toBe("Store");
      expect(getStoreName(DEFAULT_SETTINGS.store_name, "en")).toBe("Store");
    });

    it("returns locale-specific name when set", () => {
      const storeNames = { az: "Mağaza", ru: "Магазин", en: "Shop" };
      expect(getStoreName(storeNames, "az")).toBe("Mağaza");
      expect(getStoreName(storeNames, "ru")).toBe("Магазин");
      expect(getStoreName(storeNames, "en")).toBe("Shop");
    });

    it("falls back to 'az' locale when requested locale is empty", () => {
      const storeNames = { az: "Mağaza", ru: "", en: "" };
      expect(getStoreName(storeNames, "ru")).toBe("Mağaza");
      expect(getStoreName(storeNames, "en")).toBe("Mağaza");
    });

    it("returns 'Store' when all values are whitespace-only", () => {
      const storeNames = { az: "   ", ru: "  ", en: " " };
      expect(getStoreName(storeNames, "az")).toBe("Store");
      expect(getStoreName(storeNames, "ru")).toBe("Store");
      expect(getStoreName(storeNames, "en")).toBe("Store");
    });
  });
});
