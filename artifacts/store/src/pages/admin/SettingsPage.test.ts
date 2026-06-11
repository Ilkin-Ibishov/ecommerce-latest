import { describe, it, expect } from "vitest";
import { hexToHsl, hslToHex } from "@/lib/settings/color-utils";

describe("hexToHsl", () => {
  it("converts pure red", () => {
    expect(hexToHsl("ff0000")).toBe("0 100% 50%");
  });

  it("converts pure green", () => {
    expect(hexToHsl("00ff00")).toBe("120 100% 50%");
  });

  it("converts pure blue", () => {
    expect(hexToHsl("0000ff")).toBe("240 100% 50%");
  });

  it("converts white", () => {
    expect(hexToHsl("ffffff")).toBe("0 0% 100%");
  });

  it("converts black", () => {
    expect(hexToHsl("000000")).toBe("0 0% 0%");
  });

  it("handles # prefix", () => {
    expect(hexToHsl("#ff0000")).toBe("0 100% 50%");
  });

  it("returns null for invalid hex (too short)", () => {
    expect(hexToHsl("fff")).toBeNull();
  });

  it("returns null for invalid hex (non-hex chars)", () => {
    expect(hexToHsl("gggggg")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(hexToHsl("")).toBeNull();
  });
});

describe("hslToHex", () => {
  it("converts pure red HSL", () => {
    expect(hslToHex("0 100% 50%")).toBe("ff0000");
  });

  it("converts pure green HSL", () => {
    expect(hslToHex("120 100% 50%")).toBe("00ff00");
  });

  it("converts pure blue HSL", () => {
    expect(hslToHex("240 100% 50%")).toBe("0000ff");
  });

  it("converts white", () => {
    expect(hslToHex("0 0% 100%")).toBe("ffffff");
  });

  it("converts black", () => {
    expect(hslToHex("0 0% 0%")).toBe("000000");
  });

  it("returns empty string for invalid HSL", () => {
    expect(hslToHex("invalid")).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(hslToHex("")).toBe("");
  });
});

describe("hexToHsl → hslToHex roundtrip", () => {
  const testCases = [
    "ff0000",
    "00ff00",
    "0000ff",
    "ffffff",
    "000000",
    "808080",
  ];

  for (const hex of testCases) {
    it(`roundtrips ${hex}`, () => {
      const hsl = hexToHsl(hex);
      expect(hsl).not.toBeNull();
      const backToHex = hslToHex(hsl!);
      expect(backToHex).toBe(hex);
    });
  }
});
