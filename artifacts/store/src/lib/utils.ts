import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Selects a localized field from a list of translation entries.
 *
 * Supports both key shapes present across existing call sites: entries keyed by
 * `lang_code` OR by `locale`.
 *
 * Resolution order (mirrors the ~20 inline reimplementations, e.g.
 * `t => t.lang_code === locale ? t.title ?? translations[0]?.title ?? "Untitled"`):
 *   1. the entry whose `lang_code` or `locale` equals `locale` → its `field`
 *   2. else the first entry's `field`
 *   3. else `fallback`
 *
 * Like the inline `??` chains, a present-but-empty value (e.g. `""`) is returned
 * as-is; fallback only applies when the value is `undefined`/`null` (missing).
 */
export function getTranslatedField(
  translations: Array<Record<string, unknown>> | null | undefined,
  locale: string,
  field: string,
  fallback: string,
): string {
  if (!translations || translations.length === 0) return fallback

  const matched = translations.find(
    (t) => t.lang_code === locale || t.locale === locale,
  )

  const matchedValue = matched?.[field]
  if (matchedValue !== undefined && matchedValue !== null) {
    return matchedValue as string
  }

  const firstValue = translations[0]?.[field]
  if (firstValue !== undefined && firstValue !== null) {
    return firstValue as string
  }

  return fallback
}
