import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import {
  getStoredLocale,
  VALID_LOCALES,
  LOCALE_STORAGE_KEY,
  DEFAULT_LOCALE,
} from "../pages/admin/AdminLayout";

// ─── Mock localStorage for Node environment ─────────────────────────────────────

let store: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { store = {}; },
  get length() { return Object.keys(store).length; },
  key: (index: number) => Object.keys(store)[index] ?? null,
};

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", localStorageMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Property 1: Invalid locale fallback ────────────────────────────────────────
// **Validates: Requirements 1.3, 2.3**
//
// For any string stored in localStorage under "admin-locale" that is not one of
// "az", "ru", or "en" (including empty string, whitespace, numbers, unicode),
// the resolved admin locale SHALL be "en" and "en" SHALL be persisted back.

describe("Feature: admin-panel-i18n, Property 1: Invalid locale fallback", () => {
  /**
   * For any non-valid locale string, getStoredLocale() returns "en".
   */
  it("returns 'en' for any non-valid locale string stored in localStorage", () => {
    // Generate arbitrary strings that are NOT valid locales
    const invalidLocaleArb = fc.oneof(
      // Empty string
      fc.constant(""),
      // Whitespace-only strings
      fc.constantFrom(" ", "  ", "\t", "\n", "\r", "   ", " \t\n"),
      // Numeric strings
      fc.integer().map(String),
      // Known invalid values that look locale-like
      fc.constantFrom("xx", "en-US", "AZ", "RU", "EN", "null", "undefined", "fr", "de", "es"),
      // Arbitrary unicode strings filtered to exclude valid locales
      fc.string({ minLength: 0, maxLength: 50 }).filter(
        (s) => !(VALID_LOCALES as readonly string[]).includes(s)
      )
    );

    fc.assert(
      fc.property(invalidLocaleArb, (invalidValue) => {
        // Set the invalid value in mock localStorage
        store[LOCALE_STORAGE_KEY] = invalidValue;

        // Call getStoredLocale — should return the default "en"
        const result = getStoredLocale();

        expect(result).toBe(DEFAULT_LOCALE);
      }),
      { numRuns: 200 }
    );
  });

  it("returns 'en' when localStorage has no admin-locale key", () => {
    // localStorage is empty — no key set
    const result = getStoredLocale();
    expect(result).toBe(DEFAULT_LOCALE);
  });
});
