import { describe, it, expect } from "vitest";
import { isValidHsl, validateColors, validateFonts } from "../src/routes/site-settings";

describe("isValidHsl", () => {
  it("accepts valid HSL strings", () => {
    expect(isValidHsl("220 70% 50%")).toBe(true);
    expect(isValidHsl("0 0% 0%")).toBe(true);
    expect(isValidHsl("360 100% 100%")).toBe(true);
    expect(isValidHsl("180 50% 50%")).toBe(true);
    expect(isValidHsl("45 93% 47%")).toBe(true);
  });

  it("accepts decimal values in HSL", () => {
    expect(isValidHsl("220.5 70.5% 50.5%")).toBe(true);
    expect(isValidHsl("0.1 0.1% 0.1%")).toBe(true);
  });

  it("rejects hue > 360", () => {
    expect(isValidHsl("361 70% 50%")).toBe(false);
    expect(isValidHsl("400 50% 50%")).toBe(false);
  });

  it("rejects saturation > 100", () => {
    expect(isValidHsl("220 101% 50%")).toBe(false);
  });

  it("rejects lightness > 100", () => {
    expect(isValidHsl("220 70% 101%")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidHsl(null)).toBe(false);
    expect(isValidHsl(undefined)).toBe(false);
    expect(isValidHsl(123)).toBe(false);
    expect(isValidHsl({})).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidHsl("")).toBe(false);
    expect(isValidHsl("220")).toBe(false);
    expect(isValidHsl("220 70%")).toBe(false);
    expect(isValidHsl("hsl(220, 70%, 50%)")).toBe(false);
    expect(isValidHsl("220, 70%, 50%")).toBe(false);
    expect(isValidHsl("abc 70% 50%")).toBe(false);
    expect(isValidHsl("-1 70% 50%")).toBe(false);
  });
});

describe("validateColors", () => {
  const validColors = {
    primary: "220 70% 50%",
    secondary: "220 20% 20%",
    accent: "45 93% 47%",
    background: "0 0% 100%",
    text: "220 20% 10%",
    muted: "220 10% 60%",
  };

  it("returns null for a valid colors object", () => {
    expect(validateColors(validColors)).toBeNull();
  });

  it("returns error for non-object input", () => {
    expect(validateColors(null)).not.toBeNull();
    expect(validateColors("string")).not.toBeNull();
    expect(validateColors(123)).not.toBeNull();
    expect(validateColors([])).not.toBeNull();
  });

  it("returns errors for missing keys", () => {
    const { primary, ...missing } = validColors;
    const errors = validateColors(missing);
    expect(errors).not.toBeNull();
    expect(errors!["colors.primary"]).toBeDefined();
  });

  it("returns errors for extra keys", () => {
    const withExtra = { ...validColors, extra: "100 50% 50%" };
    const errors = validateColors(withExtra);
    expect(errors).not.toBeNull();
    expect(errors!["colors.extra"]).toBeDefined();
  });

  it("returns errors for invalid HSL values", () => {
    const invalid = { ...validColors, primary: "bad value" };
    const errors = validateColors(invalid);
    expect(errors).not.toBeNull();
    expect(errors!["colors.primary"]).toBeDefined();
  });

  it("returns errors when a color value is not a string", () => {
    const invalid = { ...validColors, primary: 123 };
    const errors = validateColors(invalid);
    expect(errors).not.toBeNull();
    expect(errors!["colors.primary"]).toBeDefined();
  });
});

describe("validateFonts", () => {
  const validFonts = { heading: "Inter", body: "Roboto" };

  it("returns null for valid fonts object", () => {
    expect(validateFonts(validFonts)).toBeNull();
  });

  it("returns error for non-object input", () => {
    expect(validateFonts(null)).not.toBeNull();
    expect(validateFonts("string")).not.toBeNull();
    expect(validateFonts(123)).not.toBeNull();
    expect(validateFonts([])).not.toBeNull();
  });

  it("returns errors for missing keys", () => {
    const errors = validateFonts({ heading: "Inter" });
    expect(errors).not.toBeNull();
    expect(errors!["fonts.body"]).toBeDefined();
  });

  it("returns errors for extra keys", () => {
    const errors = validateFonts({ heading: "Inter", body: "Roboto", extra: "Lato" });
    expect(errors).not.toBeNull();
    expect(errors!["fonts.extra"]).toBeDefined();
  });

  it("returns errors for empty string values", () => {
    const errors = validateFonts({ heading: "", body: "Roboto" });
    expect(errors).not.toBeNull();
    expect(errors!["fonts.heading"]).toBeDefined();
  });

  it("returns errors for strings exceeding 100 characters", () => {
    const longName = "A".repeat(101);
    const errors = validateFonts({ heading: longName, body: "Roboto" });
    expect(errors).not.toBeNull();
    expect(errors!["fonts.heading"]).toBeDefined();
  });

  it("accepts strings of exactly 100 characters", () => {
    const maxName = "A".repeat(100);
    expect(validateFonts({ heading: maxName, body: "Roboto" })).toBeNull();
  });

  it("returns errors for non-string values", () => {
    const errors = validateFonts({ heading: 123, body: "Roboto" });
    expect(errors).not.toBeNull();
    expect(errors!["fonts.heading"]).toBeDefined();
  });
});
