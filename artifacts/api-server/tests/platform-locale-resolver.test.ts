import { describe, it, expect } from "vitest";
import {
  resolveLocaleString,
  validateLocaleKeyParity,
} from "../src/lib/platform/locale-resolver";

// Feature: super-admin-platform, Task 20.1
// Unit tests for resolveLocaleString and validateLocaleKeyParity

describe("resolveLocaleString", () => {
  const messages = {
    az: { greeting: "Salam", farewell: "Sağ ol", onlyAz: "Yalnız az" },
    ru: { greeting: "Привет", farewell: "До свидания", onlyRu: "Только ру" },
    en: { greeting: "Hello", farewell: "Goodbye", onlyEn: "Only en" },
  };

  it("returns the value for the key in the requested locale when present", () => {
    expect(resolveLocaleString({ key: "greeting", locale: "en", messages })).toBe("Hello");
    expect(resolveLocaleString({ key: "greeting", locale: "ru", messages })).toBe("Привет");
    expect(resolveLocaleString({ key: "greeting", locale: "az", messages })).toBe("Salam");
  });

  it("falls back to 'az' when key is missing in the requested locale", () => {
    expect(resolveLocaleString({ key: "onlyAz", locale: "en", messages })).toBe("Yalnız az");
    expect(resolveLocaleString({ key: "onlyAz", locale: "ru", messages })).toBe("Yalnız az");
  });

  it("returns '[missing]' when key is missing in both the requested locale and 'az'", () => {
    expect(resolveLocaleString({ key: "nonexistent", locale: "en", messages })).toBe("[missing]");
    expect(resolveLocaleString({ key: "nonexistent", locale: "az", messages })).toBe("[missing]");
  });

  it("never returns the raw key", () => {
    const result = resolveLocaleString({ key: "some.raw.key", locale: "en", messages });
    expect(result).not.toBe("some.raw.key");
    expect(result).toBe("[missing]");
  });

  it("treats empty string values as missing and falls back to 'az'", () => {
    const msgs = {
      az: { title: "Başlıq" },
      ru: { title: "" },
      en: { title: "" },
    };
    expect(resolveLocaleString({ key: "title", locale: "ru", messages: msgs })).toBe("Başlıq");
    expect(resolveLocaleString({ key: "title", locale: "en", messages: msgs })).toBe("Başlıq");
  });

  it("treats empty string in 'az' as missing and returns placeholder", () => {
    const msgs = {
      az: { title: "" },
      ru: { title: "" },
      en: { title: "" },
    };
    expect(resolveLocaleString({ key: "title", locale: "en", messages: msgs })).toBe("[missing]");
    expect(resolveLocaleString({ key: "title", locale: "az", messages: msgs })).toBe("[missing]");
  });

  it("returns the az value directly when locale is 'az' and key is present", () => {
    expect(resolveLocaleString({ key: "onlyAz", locale: "az", messages })).toBe("Yalnız az");
  });

  it("returns placeholder when locale is 'az' and key is missing in az", () => {
    expect(resolveLocaleString({ key: "onlyEn", locale: "az", messages })).toBe("[missing]");
  });

  it("handles missing locale dictionary gracefully", () => {
    const msgs = { az: { hello: "Salam" }, ru: {}, en: {} };
    expect(resolveLocaleString({ key: "hello", locale: "ru", messages: msgs })).toBe("Salam");
  });
});

describe("validateLocaleKeyParity", () => {
  it("returns valid:true when all locales have identical keys with non-empty values", () => {
    const messages = {
      az: { greeting: "Salam", farewell: "Sağ ol" },
      ru: { greeting: "Привет", farewell: "До свидания" },
      en: { greeting: "Hello", farewell: "Goodbye" },
    };
    const result = validateLocaleKeyParity(messages);
    expect(result.valid).toBe(true);
    expect(result.missingKeys).toEqual([]);
  });

  it("reports keys missing from one locale", () => {
    const messages = {
      az: { greeting: "Salam", farewell: "Sağ ol" },
      ru: { greeting: "Привет" },
      en: { greeting: "Hello", farewell: "Goodbye" },
    };
    const result = validateLocaleKeyParity(messages);
    expect(result.valid).toBe(false);
    expect(result.missingKeys).toContain("farewell");
  });

  it("reports keys with empty string values as missing", () => {
    const messages = {
      az: { greeting: "Salam", farewell: "" },
      ru: { greeting: "Привет", farewell: "До свидания" },
      en: { greeting: "Hello", farewell: "Goodbye" },
    };
    const result = validateLocaleKeyParity(messages);
    expect(result.valid).toBe(false);
    expect(result.missingKeys).toContain("farewell");
  });

  it("reports keys present in non-az locales but missing from az", () => {
    const messages = {
      az: { greeting: "Salam" },
      ru: { greeting: "Привет", extra: "Дополнительно" },
      en: { greeting: "Hello" },
    };
    const result = validateLocaleKeyParity(messages);
    expect(result.valid).toBe(false);
    expect(result.missingKeys).toContain("extra");
  });

  it("handles empty dictionaries", () => {
    const messages = { az: {}, ru: {}, en: {} };
    const result = validateLocaleKeyParity(messages);
    expect(result.valid).toBe(true);
    expect(result.missingKeys).toEqual([]);
  });

  it("reports multiple missing keys", () => {
    const messages = {
      az: { a: "A", b: "B", c: "C" },
      ru: { a: "А" },
      en: { a: "A", c: "C" },
    };
    const result = validateLocaleKeyParity(messages);
    expect(result.valid).toBe(false);
    expect(result.missingKeys).toContain("b");
    expect(result.missingKeys).toContain("c");
  });

  it("does not duplicate keys in missingKeys", () => {
    const messages = {
      az: { x: "X" },
      ru: {},
      en: {},
    };
    const result = validateLocaleKeyParity(messages);
    expect(result.valid).toBe(false);
    // 'x' is missing in both ru and en, but should appear only once
    const count = result.missingKeys.filter((k) => k === "x").length;
    expect(count).toBe(1);
  });

  it("handles single-key dictionaries correctly", () => {
    const messages = {
      az: { only: "Tək" },
      ru: { only: "Единственный" },
      en: { only: "Only" },
    };
    const result = validateLocaleKeyParity(messages);
    expect(result.valid).toBe(true);
    expect(result.missingKeys).toEqual([]);
  });
});
