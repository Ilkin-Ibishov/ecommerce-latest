/**
 * Image proxy utility for wsrv.nl CDN-based image optimization.
 *
 * Generates proxied URLs that resize, convert to WebP, and cache
 * product images on the edge — no self-hosted infrastructure needed.
 */

export type ImagePreset = "thumbnail" | "gallery" | "lightbox";

export interface PresetConfig {
  width: number;
  height: number;
  quality: number;
  fit: "cover" | "inside";
}

export const PRESETS: Record<ImagePreset, PresetConfig> = {
  thumbnail: { width: 300, height: 300, quality: 80, fit: "cover" },
  gallery: { width: 1000, height: 1000, quality: 85, fit: "inside" },
  lightbox: { width: 1600, height: 1600, quality: 90, fit: "inside" },
};

const WSRV_BASE = "https://wsrv.nl/";

/**
 * Generate a proxied image URL through wsrv.nl with the given preset.
 *
 * The raw URL is encoded with `encodeURIComponent` to avoid parameter
 * collision when it contains query strings or special characters.
 */
export function getProxyUrl(rawUrl: string, preset: ImagePreset): string {
  const config = PRESETS[preset];
  const params = new URLSearchParams();
  params.set("url", rawUrl);
  params.set("w", String(config.width));
  params.set("h", String(config.height));
  params.set("output", "webp");
  params.set("q", String(config.quality));
  params.set("fit", config.fit);
  return `${WSRV_BASE}?${params.toString()}`;
}

/**
 * Extract the original image URL from a wsrv.nl proxy URL.
 *
 * Returns `null` if the URL is not a valid wsrv.nl proxy URL or
 * if the `url` parameter is missing.
 */
export function extractOriginalUrl(proxyUrl: string): string | null {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.origin + "/" !== WSRV_BASE && parsed.origin !== WSRV_BASE.slice(0, -1)) {
      return null;
    }
    const originalUrl = parsed.searchParams.get("url");
    return originalUrl || null;
  } catch {
    return null;
  }
}
