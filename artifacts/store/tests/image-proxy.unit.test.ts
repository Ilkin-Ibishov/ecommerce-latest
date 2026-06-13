import { describe, it, expect } from "vitest";
import {
  getProxyUrl,
  extractOriginalUrl,
  PRESETS,
  type ImagePreset,
} from "@/lib/image-proxy";

describe("getProxyUrl - specific preset outputs for known URLs", () => {
  const knownUrl = "https://example.com/images/product.jpg";

  it("generates correct thumbnail URL for a known input", () => {
    const result = getProxyUrl(knownUrl, "thumbnail");
    const parsed = new URL(result);

    expect(parsed.origin + "/").toBe("https://wsrv.nl/");
    expect(parsed.searchParams.get("url")).toBe(knownUrl);
    expect(parsed.searchParams.get("w")).toBe("300");
    expect(parsed.searchParams.get("h")).toBe("300");
    expect(parsed.searchParams.get("q")).toBe("80");
    expect(parsed.searchParams.get("output")).toBe("webp");
    expect(parsed.searchParams.get("fit")).toBe("cover");
  });

  it("generates correct gallery URL for a known input", () => {
    const result = getProxyUrl(knownUrl, "gallery");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(knownUrl);
    expect(parsed.searchParams.get("w")).toBe("1000");
    expect(parsed.searchParams.get("h")).toBe("1000");
    expect(parsed.searchParams.get("q")).toBe("85");
    expect(parsed.searchParams.get("output")).toBe("webp");
    expect(parsed.searchParams.get("fit")).toBe("inside");
  });

  it("generates correct lightbox URL for a known input", () => {
    const result = getProxyUrl(knownUrl, "lightbox");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(knownUrl);
    expect(parsed.searchParams.get("w")).toBe("1600");
    expect(parsed.searchParams.get("h")).toBe("1600");
    expect(parsed.searchParams.get("q")).toBe("90");
    expect(parsed.searchParams.get("output")).toBe("webp");
    expect(parsed.searchParams.get("fit")).toBe("inside");
  });

  it("preset configs match documented values", () => {
    expect(PRESETS.thumbnail).toEqual({
      width: 300,
      height: 300,
      quality: 80,
      fit: "cover",
    });
    expect(PRESETS.gallery).toEqual({
      width: 1000,
      height: 1000,
      quality: 85,
      fit: "inside",
    });
    expect(PRESETS.lightbox).toEqual({
      width: 1600,
      height: 1600,
      quality: 90,
      fit: "inside",
    });
  });
});

describe("getProxyUrl - URLs with encoded characters", () => {
  it("handles URL with query parameters correctly", () => {
    const url = "https://cdn.example.com/img.jpg?token=abc123&size=large";
    const result = getProxyUrl(url, "thumbnail");
    const parsed = new URL(result);

    // The url param should preserve the original URL including its query string
    expect(parsed.searchParams.get("url")).toBe(url);
  });

  it("handles URL with unicode characters", () => {
    const url = "https://example.com/продукт/фото.jpg";
    const result = getProxyUrl(url, "gallery");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(url);
  });

  it("handles URL with special characters (spaces, brackets, etc.)", () => {
    const url = "https://example.com/path/image [1].jpg";
    const result = getProxyUrl(url, "thumbnail");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(url);
  });

  it("handles URL with hash/fragment", () => {
    const url = "https://example.com/image.jpg#section";
    const result = getProxyUrl(url, "lightbox");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(url);
  });

  it("handles URL with percent-encoded characters", () => {
    const url = "https://example.com/path%20to%20image/file%2B1.jpg";
    const result = getProxyUrl(url, "thumbnail");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(url);
  });
});

describe("getProxyUrl - long URLs", () => {
  it("handles a very long URL (2000+ characters)", () => {
    const longPath = "a".repeat(2000);
    const url = `https://example.com/${longPath}.jpg`;
    const result = getProxyUrl(url, "thumbnail");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(url);
    expect(parsed.searchParams.get("w")).toBe("300");
  });
});

describe("getProxyUrl - missing protocol and edge cases", () => {
  it("passes through empty string URL as-is", () => {
    const result = getProxyUrl("", "thumbnail");
    const parsed = new URL(result);

    // Empty string is still set as the url param
    expect(parsed.searchParams.get("url")).toBe("");
    expect(parsed.searchParams.get("w")).toBe("300");
  });

  it("passes through http:// URL without modification", () => {
    // getProxyUrl doesn't validate protocol — it just generates the proxy URL
    const url = "http://example.com/image.jpg";
    const result = getProxyUrl(url, "gallery");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(url);
  });

  it("passes through URL without protocol as-is", () => {
    const url = "example.com/image.jpg";
    const result = getProxyUrl(url, "thumbnail");
    const parsed = new URL(result);

    expect(parsed.searchParams.get("url")).toBe(url);
  });
});

describe("extractOriginalUrl - successful extraction", () => {
  it("extracts original URL from a valid proxy URL", () => {
    const originalUrl = "https://example.com/product.jpg";
    const proxyUrl = getProxyUrl(originalUrl, "thumbnail");
    const extracted = extractOriginalUrl(proxyUrl);

    expect(extracted).toBe(originalUrl);
  });

  it("extracts URL with query parameters from proxy URL", () => {
    const originalUrl = "https://cdn.example.com/img.jpg?token=abc&v=2";
    const proxyUrl = getProxyUrl(originalUrl, "gallery");
    const extracted = extractOriginalUrl(proxyUrl);

    expect(extracted).toBe(originalUrl);
  });

  it("extracts URL with unicode characters from proxy URL", () => {
    const originalUrl = "https://example.com/изображение.jpg";
    const proxyUrl = getProxyUrl(originalUrl, "lightbox");
    const extracted = extractOriginalUrl(proxyUrl);

    expect(extracted).toBe(originalUrl);
  });
});

describe("extractOriginalUrl - malformed/missing params", () => {
  it("returns null for non-wsrv.nl URL", () => {
    const result = extractOriginalUrl("https://other-proxy.com/?url=https://example.com/img.jpg");
    expect(result).toBeNull();
  });

  it("returns null for wsrv.nl URL without url parameter", () => {
    const result = extractOriginalUrl("https://wsrv.nl/?w=300&h=300");
    expect(result).toBeNull();
  });

  it("returns null for wsrv.nl URL with empty url parameter", () => {
    const result = extractOriginalUrl("https://wsrv.nl/?url=&w=300");
    expect(result).toBeNull();
  });

  it("returns null for completely invalid URL string", () => {
    const result = extractOriginalUrl("not a url at all");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = extractOriginalUrl("");
    expect(result).toBeNull();
  });

  it("returns null for URL with different protocol (http://wsrv.nl)", () => {
    const result = extractOriginalUrl("http://wsrv.nl/?url=https://example.com/img.jpg");
    expect(result).toBeNull();
  });

  it("returns null for URL with subdomain (https://sub.wsrv.nl)", () => {
    const result = extractOriginalUrl("https://sub.wsrv.nl/?url=https://example.com/img.jpg");
    expect(result).toBeNull();
  });

  it("returns null for partial URL-like string", () => {
    const result = extractOriginalUrl("://wsrv.nl/?url=test");
    expect(result).toBeNull();
  });
});

describe("getProxyUrl - idempotence", () => {
  it("returns identical output for repeated calls with same inputs", () => {
    const url = "https://example.com/product.jpg";
    const presets: ImagePreset[] = ["thumbnail", "gallery", "lightbox"];

    for (const preset of presets) {
      const first = getProxyUrl(url, preset);
      const second = getProxyUrl(url, preset);
      expect(first).toBe(second);
    }
  });
});
