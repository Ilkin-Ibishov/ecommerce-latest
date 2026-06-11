import { Router, type IRouter } from "express";
import multer from "multer";
import { getAdminSupabase, requireAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { validateAndUpload, AssetValidationError, type AssetCategory } from "../lib/asset-uploader.js";

const router: IRouter = Router();

/** Valid keys for the colors JSONB field */
const COLOR_KEYS = ["primary", "secondary", "accent", "background", "text", "muted"] as const;

/** Valid keys for the fonts JSONB field */
const FONT_KEYS = ["heading", "body"] as const;

/** Recognized top-level fields in site_settings that may be updated via PATCH */
const VALID_FIELDS = [
  "store_name",
  "colors",
  "fonts",
  "logo_url",
  "favicon_url",
  "contact",
  "working_hours",
  "footer_text",
] as const;

/**
 * Validate an HSL color string in format "H S% L%"
 * H must be 0-360, S must be 0-100, L must be 0-100
 */
export function isValidHsl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) return false;
  const h = parseFloat(match[1]);
  const s = parseFloat(match[2]);
  const l = parseFloat(match[3]);
  return h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100;
}

/**
 * Validate the colors JSONB object.
 * Must contain exactly the keys: primary, secondary, accent, background, text, muted.
 * Each value must be a valid HSL string.
 * Returns an object with field-level error details or null if valid.
 */
export function validateColors(colors: unknown): Record<string, string> | null {
  if (typeof colors !== "object" || colors === null || Array.isArray(colors)) {
    return { colors: "Must be an object with keys: primary, secondary, accent, background, text, muted" };
  }

  const obj = colors as Record<string, unknown>;
  const objKeys = Object.keys(obj);
  const errors: Record<string, string> = {};

  // Check for exactly the required keys
  const requiredKeys = new Set<string>(COLOR_KEYS);
  const providedKeys = new Set(objKeys);

  for (const key of requiredKeys) {
    if (!providedKeys.has(key)) {
      errors[`colors.${key}`] = "Missing required color key";
    }
  }

  for (const key of providedKeys) {
    if (!requiredKeys.has(key)) {
      errors[`colors.${key}`] = "Unrecognized color key";
    }
  }

  if (Object.keys(errors).length > 0) {
    return errors;
  }

  // Validate each color value
  for (const key of COLOR_KEYS) {
    if (!isValidHsl(obj[key])) {
      errors[`colors.${key}`] = `Invalid HSL format. Expected "H S% L%" (e.g., "220 70% 50%")`;
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Validate the fonts JSONB object.
 * Must contain exactly the keys: heading, body.
 * Each value must be a non-empty string of at most 100 characters.
 * Returns an object with field-level error details or null if valid.
 */
export function validateFonts(fonts: unknown): Record<string, string> | null {
  if (typeof fonts !== "object" || fonts === null || Array.isArray(fonts)) {
    return { fonts: "Must be an object with keys: heading, body" };
  }

  const obj = fonts as Record<string, unknown>;
  const objKeys = Object.keys(obj);
  const errors: Record<string, string> = {};

  // Check for exactly the required keys
  const requiredKeys = new Set<string>(FONT_KEYS);
  const providedKeys = new Set(objKeys);

  for (const key of requiredKeys) {
    if (!providedKeys.has(key)) {
      errors[`fonts.${key}`] = "Missing required font key";
    }
  }

  for (const key of providedKeys) {
    if (!requiredKeys.has(key)) {
      errors[`fonts.${key}`] = "Unrecognized font key";
    }
  }

  if (Object.keys(errors).length > 0) {
    return errors;
  }

  // Validate each font value
  for (const key of FONT_KEYS) {
    const val = obj[key];
    if (typeof val !== "string" || val.length === 0) {
      errors[`fonts.${key}`] = "Must be a non-empty string";
    } else if (val.length > 100) {
      errors[`fonts.${key}`] = "Must be at most 100 characters";
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/** Default settings returned when no row exists in site_settings */
const DEFAULT_SETTINGS = {
  id: "00000000-0000-0000-0000-000000000001",
  store_name: { az: "", ru: "", en: "" },
  colors: {
    primary: "",
    secondary: "",
    accent: "",
    background: "",
    text: "",
    muted: "",
  },
  fonts: { heading: "", body: "" },
  logo_url: null,
  favicon_url: null,
  contact: { phone: "", email: "", address: "", social_links: {} },
  working_hours: { az: "", ru: "", en: "" },
  footer_text: { az: "", ru: "", en: "" },
  created_at: null,
  updated_at: null,
};

/**
 * Fire-and-forget audit log writer for site settings updates.
 * Logs errors but never blocks the response.
 */
function logSettingsAudit(
  admin: any,
  actorId: string,
  entityId: string,
  changes: Record<string, unknown>
): void {
  (admin as any)
    .from("audit_log")
    .insert({
      actor_id: actorId,
      action: "update_settings",
      entity: "site_settings",
      entity_id: entityId,
      changes,
    })
    .then(({ error }: { error: any }) => {
      if (error) {
        logger.error({ error, actorId, entityId }, "Failed to write settings audit log");
      }
    })
    .catch((err: unknown) => {
      logger.error({ err, actorId, entityId }, "Unexpected error writing settings audit log");
    });
}

/**
 * GET /api/site-settings
 * Public endpoint — returns the full site_settings row or defaults.
 */
router.get("/site-settings", async (req, res): Promise<void> => {
  const supabase = getAdminSupabase();

  const { data, error } = await (supabase as any)
    .from("site_settings")
    .select("*")
    .single();

  if (error || !data) {
    req.log.info("No site_settings row found, returning defaults");
    res.json(DEFAULT_SETTINGS);
    return;
  }

  res.json(data);
});

/**
 * PATCH /api/site-settings
 * Admin-only endpoint — partial update with validation.
 * Ignores unrecognized fields, validates colors and fonts JSONB.
 * Returns 400 with field-level error details on validation failure.
 */
router.patch("/site-settings", async (req, res): Promise<void> => {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = req.body as Record<string, unknown>;

  // Filter to only recognized fields
  const updates: Record<string, unknown> = {};
  for (const field of VALID_FIELDS) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  // If no valid fields provided, return early with success (nothing to update)
  if (Object.keys(updates).length === 0) {
    const supabase = getAdminSupabase();
    const { data } = await (supabase as any)
      .from("site_settings")
      .select("*")
      .single();
    res.json(data);
    return;
  }

  // Validate colors if provided
  const allErrors: Record<string, string> = {};

  if ("colors" in updates) {
    const colorErrors = validateColors(updates.colors);
    if (colorErrors) {
      Object.assign(allErrors, colorErrors);
    }
  }

  // Validate fonts if provided
  if ("fonts" in updates) {
    const fontErrors = validateFonts(updates.fonts);
    if (fontErrors) {
      Object.assign(allErrors, fontErrors);
    }
  }

  // Return 400 with field-level error details if validation failed
  if (Object.keys(allErrors).length > 0) {
    res.status(400).json({ error: "Validation failed", details: allErrors });
    return;
  }

  // Set updated_at explicitly in the same update
  updates.updated_at = new Date().toISOString();

  const supabase = getAdminSupabase();
  const { data, error } = await (supabase as any)
    .from("site_settings")
    .update(updates)
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .select("*")
    .single();

  if (error) {
    req.log.error({ error }, "Failed to update site_settings");
    res.status(500).json({ error: "Failed to update settings" });
    return;
  }

  req.log.info({ userId: ctx.user.id, fields: Object.keys(updates) }, "Site settings updated");

  // Fire-and-forget audit log — only include the fields the admin actually changed
  const auditChanges = { ...updates };
  delete auditChanges.updated_at;
  logSettingsAudit(supabase, ctx.user.id, "00000000-0000-0000-0000-000000000001", auditChanges);

  res.json(data);
});

// ---------------------------------------------------------------------------
// File upload endpoints
// ---------------------------------------------------------------------------

/** Multer configured for in-memory storage (buffer), single file field named 'file' */
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Shared upload handler for logo and favicon.
 * Validates and uploads the file, then updates the corresponding URL in site_settings.
 */
async function handleAssetUpload(
  req: any,
  res: any,
  category: AssetCategory,
  urlField: "logo_url" | "favicon_url"
): Promise<void> {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ error: "No file provided. Use form field name 'file'." });
    return;
  }

  // Fetch current settings to get previousUrl for cleanup
  const supabase = getAdminSupabase();
  const { data: currentSettings } = await (supabase as any)
    .from("site_settings")
    .select(urlField)
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .single();

  const previousUrl = currentSettings?.[urlField] ?? null;

  try {
    const result = await validateAndUpload({
      category,
      file: file.buffer,
      originalName: file.originalname,
      previousUrl,
    });

    // Update the corresponding URL field in site_settings
    const updatePayload: Record<string, unknown> = {
      [urlField]: result.url,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await (supabase as any)
      .from("site_settings")
      .update(updatePayload)
      .eq("id", "00000000-0000-0000-0000-000000000001");

    if (updateError) {
      req.log.error({ error: updateError }, `Failed to update ${urlField} in site_settings`);
      res.status(500).json({ error: `Upload succeeded but failed to update settings` });
      return;
    }

    req.log.info({ userId: ctx.user.id, category, url: result.url }, `${category} uploaded`);
    res.json({ url: result.url, path: result.path });
  } catch (err: unknown) {
    if (err instanceof AssetValidationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, `Unexpected error uploading ${category}`);
    res.status(500).json({ error: "Upload failed due to an internal error" });
  }
}

/**
 * POST /api/site-settings/upload/logo
 * Admin-only — upload a logo image.
 */
router.post("/site-settings/upload/logo", upload.single("file"), async (req, res): Promise<void> => {
  await handleAssetUpload(req, res, "logo", "logo_url");
});

/**
 * POST /api/site-settings/upload/favicon
 * Admin-only — upload a favicon image.
 */
router.post("/site-settings/upload/favicon", upload.single("file"), async (req, res): Promise<void> => {
  await handleAssetUpload(req, res, "favicon", "favicon_url");
});

export default router;
