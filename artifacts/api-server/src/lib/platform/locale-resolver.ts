/**
 * Platform i18n locale resolver.
 *
 * Pure module: resolves localized strings for platform UI surfaces and email rendering.
 *
 * Resolution chain:
 *   1. Return the value for the requested locale when present.
 *   2. Fall back to the default locale (`az`) when the key is missing in the requested locale.
 *   3. Render a non-key placeholder when the key is missing in BOTH the requested locale and `az`.
 *      The raw key is NEVER rendered.
 *
 * Requirements: 4.2, 4.3, 7.7, 12.2, 12.5, 12.6, 13.12, 15.10, 18.5, 18.6, 19.11
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Supported platform locales */
export type PlatformLocale = "az" | "ru" | "en";

/** The default/fallback locale */
export const DEFAULT_LOCALE: PlatformLocale = "az";

/** All supported locales */
export const SUPPORTED_LOCALES: readonly PlatformLocale[] = ["az", "ru", "en"] as const;

/** A flat or nested message dictionary (string values at the leaves) */
export type MessageDictionary = { [key: string]: string | MessageDictionary };

/** The full set of locale dictionaries keyed by locale */
export type LocaleMessages = Record<PlatformLocale, MessageDictionary>;

/**
 * The placeholder rendered when a key is missing in both the requested locale
 * and the default locale. Never the raw key itself.
 */
export const MISSING_KEY_PLACEHOLDER = "[⚠ translation missing]";

// ─── Locale Normalization ──────────────────────────────────────────────────────

/**
 * Normalize and validate a locale string.
 * Returns the locale if it's supported, or the default locale otherwise.
 *
 * Covers R4.3 (undefined/unsupported → `az`) and R18.6 (no selected locale → `az`).
 */
export function normalizeLocale(locale: string | null | undefined): PlatformLocale {
  if (locale == null) return DEFAULT_LOCALE;
  const lower = locale.trim().toLowerCase();
  if (SUPPORTED_LOCALES.includes(lower as PlatformLocale)) {
    return lower as PlatformLocale;
  }
  return DEFAULT_LOCALE;
}

// ─── Key Resolution ────────────────────────────────────────────────────────────

/**
 * Resolve a dotted key path against a message dictionary.
 * Returns the string value if found, or `undefined` if the path doesn't resolve
 * to a string value.
 */
export function resolveKey(
  dictionary: MessageDictionary,
  key: string
): string | undefined {
  const parts = key.split(".");
  let current: string | MessageDictionary = dictionary;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    const next: string | MessageDictionary | undefined = (current as MessageDictionary)[part];
    if (next === undefined) return undefined;
    current = next;
  }
  // The resolved value must be a non-empty string (empty strings are treated as missing per R12.2)
  if (typeof current === "string" && current.length > 0) {
    return current;
  }
  return undefined;
}

// ─── Core Resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a single i18n key with the full fallback chain.
 *
 * 1. If the key resolves in the requested locale's dictionary → return that value.
 * 2. Else if the key resolves in the `az` (default) dictionary → return that value.
 * 3. Else → return `MISSING_KEY_PLACEHOLDER` (never the raw key).
 *
 * This satisfies:
 * - R12.5: missing in selected locale → fall back to `az`
 * - R12.6: missing in both → non-key placeholder, never the raw key
 * - R4.2: render in the selected locale
 * - R4.3: undefined/unsupported locale → default `az`
 * - R7.7: no untranslated key or empty string
 * - R18.5: email rendered in the Store's selected locale
 * - R18.6: no selected locale → `az`
 */
export function resolveMessage(
  messages: LocaleMessages,
  locale: PlatformLocale,
  key: string
): string {
  // Step 1: try the requested locale
  const requestedDict = messages[locale];
  if (requestedDict) {
    const value = resolveKey(requestedDict, key);
    if (value !== undefined) return value;
  }

  // Step 2: fall back to the default locale (az)
  if (locale !== DEFAULT_LOCALE) {
    const fallbackDict = messages[DEFAULT_LOCALE];
    if (fallbackDict) {
      const value = resolveKey(fallbackDict, key);
      if (value !== undefined) return value;
    }
  }

  // Step 3: key missing in both → non-key placeholder (NEVER the raw key)
  return MISSING_KEY_PLACEHOLDER;
}

// ─── Factory: createPlatformT ──────────────────────────────────────────────────

/**
 * Creates a translation function `t(key)` bound to a set of locale messages
 * and a resolved locale. Applies the full resolution chain
 * (requested → az fallback → placeholder).
 *
 * Intended for both platform UI surfaces and server-side email rendering.
 */
export function createPlatformT(
  messages: LocaleMessages,
  requestedLocale: string | null | undefined
): (key: string) => string {
  const locale = normalizeLocale(requestedLocale);
  return (key: string) => resolveMessage(messages, locale, key);
}

// ─── Property 30 — Pure functions for locale resolution ────────────────────────

/**
 * Resolve a locale string from a flat messages dictionary.
 *
 * Resolution chain (Property 30):
 *   1. Return the value for the key in the requested locale if present and non-empty.
 *   2. Else fall back to 'az' (default locale).
 *   3. Else return a non-key placeholder string '[missing]' (never the raw key).
 *
 * Requirements: 4.2, 4.3, 7.7, 12.2, 12.5, 12.6, 13.12, 15.10, 18.5, 18.6, 19.11
 */
export function resolveLocaleString(input: {
  key: string;
  locale: "az" | "ru" | "en";
  messages: Record<string, Record<string, string>>;
}): string {
  const { key, locale, messages } = input;

  // Step 1: try the requested locale
  const localeDict = messages[locale];
  if (localeDict) {
    const value = localeDict[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  // Step 2: fall back to 'az' (default)
  if (locale !== "az") {
    const azDict = messages["az"];
    if (azDict) {
      const value = azDict[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }

  // Step 3: key missing in both — return placeholder, NEVER the raw key
  return "[missing]";
}

/**
 * Check that all locales have identical key sets with no empty values.
 * Returns `{ valid, missingKeys }` where missingKeys lists keys that are
 * absent or empty in any locale.
 *
 * Requirements: 12.2 (identical key sets, no empty strings)
 */
export function validateLocaleKeyParity(
  messages: Record<string, Record<string, string>>
): { valid: boolean; missingKeys: string[] } {
  const locales = ["az", "ru", "en"] as const;
  const allKeys = new Set<string>();
  const missingKeys: string[] = [];

  // Collect the union of all keys across all locales
  for (const loc of locales) {
    const dict = messages[loc];
    if (dict) {
      for (const key of Object.keys(dict)) {
        allKeys.add(key);
      }
    }
  }

  // Check every key exists in every locale with a non-empty string value
  for (const key of allKeys) {
    for (const loc of locales) {
      const dict = messages[loc];
      if (!dict || !(key in dict) || typeof dict[key] !== "string" || dict[key].length === 0) {
        if (!missingKeys.includes(key)) {
          missingKeys.push(key);
        }
        break;
      }
    }
  }

  return { valid: missingKeys.length === 0, missingKeys };
}

// ─── Validation Utilities ──────────────────────────────────────────────────────

/**
 * Collect all leaf keys from a message dictionary as dot-delimited paths.
 */
export function collectKeys(
  dict: MessageDictionary,
  prefix: string = ""
): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      keys.push(path);
    } else if (typeof v === "object" && v !== null) {
      keys.push(...collectKeys(v, path));
    }
  }
  return keys;
}

/**
 * Check that all locale dictionaries have identical key sets and no empty string values.
 * Returns an object with `valid` and any `errors`.
 *
 * Validates R12.2 (identical key sets across locales, non-empty values).
 */
export function validateLocaleConsistency(messages: LocaleMessages): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const keySets: Record<PlatformLocale, Set<string>> = {} as any;

  for (const locale of SUPPORTED_LOCALES) {
    const dict = messages[locale];
    if (!dict) {
      errors.push(`Missing dictionary for locale "${locale}"`);
      keySets[locale] = new Set();
      continue;
    }
    const keys = collectKeys(dict);
    keySets[locale] = new Set(keys);

    // Check for empty strings
    for (const key of keys) {
      const val = resolveKey(dict, key);
      if (val === undefined) {
        // resolveKey already treats empty strings as undefined, so this is a missing value
        errors.push(`Locale "${locale}" has empty/missing value for key "${key}"`);
      }
    }
  }

  // Check key set equality
  const azKeys = keySets.az;
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === "az") continue;
    const localeKeys = keySets[locale];

    // Keys in az missing from this locale
    for (const key of azKeys) {
      if (!localeKeys.has(key)) {
        errors.push(`Key "${key}" present in "az" but missing in "${locale}"`);
      }
    }
    // Keys in this locale missing from az
    for (const key of localeKeys) {
      if (!azKeys.has(key)) {
        errors.push(`Key "${key}" present in "${locale}" but missing in "az"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
