import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Cooldown tracking (in-memory, 3-second between searches)
// ---------------------------------------------------------------------------

let lastSearchTimestamp = 0;
const COOLDOWN_MS = 3000;

/**
 * Check whether the search cooldown has elapsed.
 * Returns true if a search is allowed, false if still in cooldown.
 */
export function isSearchCooldownActive(): boolean {
  return Date.now() - lastSearchTimestamp < COOLDOWN_MS;
}

/**
 * Record the current time as the last search timestamp.
 */
function markSearchPerformed(): void {
  lastSearchTimestamp = Date.now();
}

// ---------------------------------------------------------------------------
// Image Search via scrape-google-images
// ---------------------------------------------------------------------------

/**
 * Search Google Images for product photos.
 * Returns up to 20 deduplicated HTTPS image URLs.
 *
 * Enforces a 3-second cooldown between requests to avoid Google rate-limiting.
 * On failure, throws an error that should be caught by the route handler.
 */
export async function searchImages(query: string): Promise<string[]> {
  markSearchPerformed();

  try {
    // Dynamic import with indirection to avoid TypeScript resolving the package types
    // (scrape-google-images ships .ts source with DOM dependencies)
    const moduleName = "scrape-google-images";
    const scrapeModule = await (Function("m", "return import(m)")(moduleName) as Promise<any>);
    const scrape = scrapeModule.default ?? scrapeModule;

    const results: unknown = await scrape(query);

    if (!Array.isArray(results)) {
      logger.warn({ query, results: typeof results }, "scrape-google-images returned non-array");
      return [];
    }

    // Deduplicate and filter to HTTPS URLs only, limit to 20
    const seen = new Set<string>();
    const urls: string[] = [];

    for (const item of results) {
      const url = typeof item === "string" ? item : (item as any)?.url;
      if (typeof url !== "string") continue;
      if (!url.startsWith("https://")) continue;
      if (seen.has(url)) continue;

      seen.add(url);
      urls.push(url);

      if (urls.length >= 20) break;
    }

    logger.info({ query, resultCount: urls.length }, "Image search completed");
    return urls;
  } catch (error) {
    logger.error({ query, error }, "Image search failed");
    throw new Error("Image search unavailable");
  }
}

// ---------------------------------------------------------------------------
// Testing helpers (exported for unit tests only)
// ---------------------------------------------------------------------------

/** @internal Reset cooldown — for testing only */
export function _resetCooldown(): void {
  lastSearchTimestamp = 0;
}

/** @internal Get last search timestamp — for testing only */
export function _getLastSearchTimestamp(): number {
  return lastSearchTimestamp;
}
