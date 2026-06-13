// Feature: product-image-management, Property 1: Proxy URL format correctness
// Feature: product-image-management, Property 2: Proxy URL round-trip encoding
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getProxyUrl, extractOriginalUrl, PRESETS, type ImagePreset } from "@/lib/image-proxy";

// ─── Shared Generators ─────────────────────────────────────────────────────────

/** Generate a valid HTTPS URL with various paths */
const validHttpsUrlArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{2,14}$/).filter((s) => s.length >= 3),
    fc.constantFrom("com", "org", "net", "io", "co.uk"),
    fc.array(
      fc.stringMatching(/^[a-z0-9_-]{1,12}$/).filter((s) => s.length > 0),
      { minLength: 0, maxLength: 4 }
    ),
    fc.constantFrom("", ".jpg", ".png", ".webp", ".avif", "")
  )
  .map(([host, tld, segments, ext]) => {
    const path = segments.length > 0 ? "/" + segments.join("/") : "";
    return `https://${host}.${tld}${path}${ext}`;
  });

/** Generate HTTPS URLs with query parameters to test encoding */
const httpsUrlWithQueryArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/).filter((s) => s.length >= 3),
    fc.constantFrom("com", "org", "net"),
    fc.array(
      fc.tuple(
        fc.stringMatching(/^[a-z]{1,8}$/).filter((s) => s.length > 0),
        fc.stringMatching(/^[a-z0-9]{1,12}$/).filter((s) => s.length > 0)
      ),
      { minLength: 1, maxLength: 3 }
    )
  )
  .map(([host, tld, params]) => {
    const qs = params.map(([k, v]) => `${k}=${v}`).join("&");
    return `https://${host}.${tld}/image.jpg?${qs}`;
  });

/** All valid preset names */
const presetArb = fc.constantFrom<ImagePreset>("thumbnail", "gallery", "lightbox");

// ─── Property 1: Proxy URL format correctness ──────────────────────────────────

/**
 * Property 1: Proxy URL format correctness
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * For any valid HTTPS image URL and any image preset (thumbnail, gallery, lightbox),
 * the generated proxy URL SHALL contain the base `https://wsrv.nl/?url=`, the
 * URL-encoded original URL, and the correct width, height, quality, output, and fit
 * parameters matching the preset configuration.
 */
