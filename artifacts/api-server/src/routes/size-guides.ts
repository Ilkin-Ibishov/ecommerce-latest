import { Router, type IRouter } from "express";
import { getAdminSupabase } from "../lib/supabase";

const router: IRouter = Router();

const SUPPORTED_LOCALES = ["az", "ru", "en"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

interface SizeGuideRow {
  category_id: string;
  headers: string[];
  rows: Array<string[]>;
  measurement_unit: "cm" | "inches";
  updated_at: string;
}

/** Localized header mappings keyed by locale */
const LOCALIZED_HEADERS: Record<Locale, Record<string, string>> = {
  az: { Size: "Ölçü", Chest: "Sinə", Waist: "Bel", Hips: "Omba", Length: "Uzunluq" },
  ru: { Size: "Размер", Chest: "Грудь", Waist: "Талия", Hips: "Бёдра", Length: "Длина" },
  en: {},
};

/**
 * Translate headers based on locale.
 * Falls back to the original header value if no translation is found.
 */
function localizeHeaders(headers: string[], locale: Locale): string[] {
  if (locale === "en") return headers;
  const map = LOCALIZED_HEADERS[locale];
  return headers.map((h) => map[h] ?? h);
}

/**
 * GET /api/size-guides/:categoryId
 * Public endpoint — returns size guide data for a given category.
 * Accepts optional ?locale query parameter for localized headers.
 * Returns SizeGuideResponse shape or 404 if no size guide exists for the category.
 */
router.get("/size-guides/:categoryId", async (req, res): Promise<void> => {
  const supabase = getAdminSupabase();
  const raw = Array.isArray(req.params.categoryId) ? req.params.categoryId[0] : req.params.categoryId;
  const categoryId = raw;

  const localeParam = (req.query.locale as string) ?? "az";
  const locale: Locale = SUPPORTED_LOCALES.includes(localeParam as Locale)
    ? (localeParam as Locale)
    : "az";

  const { data, error } = await (supabase as any)
    .from("size_guides")
    .select("category_id, headers, rows, measurement_unit, updated_at")
    .eq("category_id", categoryId)
    .single();

  if (error || !data) {
    res.status(404).json({ error: "Size guide not found" });
    return;
  }

  const guide = data as SizeGuideRow;

  res.json({
    category_id: guide.category_id,
    headers: localizeHeaders(guide.headers, locale),
    rows: guide.rows,
    measurement_unit: guide.measurement_unit,
    updated_at: guide.updated_at,
  });
});

export default router;
