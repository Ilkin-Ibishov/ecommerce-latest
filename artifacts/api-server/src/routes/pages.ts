import { Router, type IRouter } from "express";
import sanitizeHtml from "sanitize-html";
import type { Database, Json } from "@workspace/supabase-types";
import { getAdminSupabase } from "../lib/supabase";
import { requireAdmin } from "../middlewares/requireAdmin";
import { writeAudit } from "../lib/audit";
import { platformStatus } from "../middlewares/platformStatus";

/**
 * sanitize-html configuration for sanitizing page content HTML.
 * Only allows safe elements and attributes as per Requirements 7.3.
 */
const SANITIZE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: ["p", "h2", "h3", "h4", "strong", "em", "ul", "ol", "li", "a", "img", "br", "blockquote"],
  allowedAttributes: {
    a: ["href"],
    img: ["src", "alt"],
  },
  disallowedTagsMode: "discard",
};

const router: IRouter = Router();

const SUPPORTED_LOCALES = ["az", "ru", "en"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Valid slug pattern: lowercase alphanumeric segments separated by hyphens */
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * GET /api/pages
 * Public endpoint — returns published pages with nav flags, ordered by sort_order ascending.
 * Accepts optional ?locale=xx query param to return titles in the requested locale.
 */
router.get("/pages", platformStatus("storefront_read"), async (req, res): Promise<void> => {
  const supabase = getAdminSupabase();
  const locale = (req.query.locale as string) ?? "az";
  const resolvedLocale: Locale = SUPPORTED_LOCALES.includes(locale as Locale)
    ? (locale as Locale)
    : "az";

  const { data: pages, error } = await supabase
    .from("pages")
    .select("id, slug, show_in_header, show_in_footer, sort_order, page_translations(locale, title)")
    .eq("published", true)
    .order("sort_order", { ascending: true });

  if (error) {
    req.log.error({ error }, "Failed to fetch pages");
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const result = (pages ?? []).map((page) => {
    const translations: Array<{ locale: string; title: string }> = page.page_translations ?? [];

    // Resolve title: requested locale → az fallback → first available → empty
    const localeTranslation = translations.find((t) => t.locale === resolvedLocale);
    const azFallback = translations.find((t) => t.locale === "az");
    const title = localeTranslation?.title ?? azFallback?.title ?? translations[0]?.title ?? "";

    return {
      id: page.id,
      slug: page.slug,
      title,
      show_in_header: page.show_in_header,
      show_in_footer: page.show_in_footer,
      sort_order: page.sort_order,
    };
  });

  res.json(result);
});

/**
 * GET /api/pages/:slug
 * Public endpoint — returns page + translation for the requested locale.
 * Accepts ?locale=xx query param. Falls back: requested locale → az → 404.
 * Only returns published pages.
 */
router.get("/pages/:slug", platformStatus("storefront_read"), async (req, res): Promise<void> => {
  const supabase = getAdminSupabase();
  const raw = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const slug = raw;
  const locale = (req.query.locale as string) ?? "az";
  const resolvedLocale: Locale = SUPPORTED_LOCALES.includes(locale as Locale)
    ? (locale as Locale)
    : "az";

  // Fetch page by slug — must be published
  const { data: page, error } = await supabase
    .from("pages")
    .select("id, slug, is_system, published, show_in_header, show_in_footer, sort_order, created_at, updated_at, page_translations(id, locale, title, content, meta_title, meta_description)")
    .eq("slug", slug)
    .eq("published", true)
    .single();

  if (error || !page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  const translations: Array<{
    id: string;
    locale: string;
    title: string;
    content: string;
    meta_title: string | null;
    meta_description: string | null;
  }> = page.page_translations ?? [];

  // Locale fallback: requested locale → az → not found
  let translation = translations.find((t) => t.locale === resolvedLocale);
  if (!translation) {
    translation = translations.find((t) => t.locale === "az");
  }

  if (!translation) {
    res.status(404).json({ error: "Translation not available" });
    return;
  }

  // Return page metadata + resolved translation
  res.json({
    id: page.id,
    slug: page.slug,
    is_system: page.is_system,
    published: page.published,
    show_in_header: page.show_in_header,
    show_in_footer: page.show_in_footer,
    sort_order: page.sort_order,
    created_at: page.created_at,
    updated_at: page.updated_at,
    translation: {
      id: translation.id,
      locale: translation.locale,
      title: translation.title,
      content: translation.content,
      meta_title: translation.meta_title,
      meta_description: translation.meta_description,
    },
    available_locales: translations.map((t) => t.locale),
  });
});

// ─── Admin Endpoints ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/pages
 * Admin-only — returns ALL pages (including unpublished/drafts) with translations.
 */
router.get("/admin/pages", requireAdmin, async (req, res): Promise<void> => {
  const ctx = { admin: req.admin!, user: req.user! };

  const { data: pages, error } = await ctx.admin
    .from("pages")
    .select("id, slug, is_system, published, show_in_header, show_in_footer, sort_order, created_at, updated_at, page_translations(id, locale, title)")
    .order("sort_order", { ascending: true });

  if (error) {
    req.log.error({ error }, "Failed to fetch admin pages");
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json(pages ?? []);
});

/**
 * POST /api/admin/pages
 * Admin-only — create a new page.
 * Validates slug format, uniqueness, title length, body length, and sort_order range.
 */
router.post("/admin/pages", requireAdmin, async (req, res): Promise<void> => {
  const ctx = { admin: req.admin!, user: req.user! };

  const { slug, title, body, published, sort_order, show_in_header, show_in_footer } = req.body;

  // Validate slug
  if (typeof slug !== "string" || slug.length === 0) {
    res.status(400).json({ error: "Slug is required" });
    return;
  }
  if (slug.length > 100) {
    res.status(400).json({ error: "Slug must be at most 100 characters" });
    return;
  }
  if (!SLUG_REGEX.test(slug)) {
    res.status(400).json({ error: "Slug must match pattern: lowercase alphanumeric segments separated by hyphens" });
    return;
  }

  // Validate title if provided
  if (title != null && typeof title === "string" && title.length > 200) {
    res.status(400).json({ error: "Title must be at most 200 characters" });
    return;
  }

  // Validate body if provided
  if (body != null && typeof body === "string" && body.length > 50000) {
    res.status(400).json({ error: "Body must be at most 50,000 characters" });
    return;
  }

  // Validate sort_order if provided
  if (sort_order != null) {
    const order = Number(sort_order);
    if (!Number.isInteger(order) || order < 0 || order > 999) {
      res.status(400).json({ error: "sort_order must be an integer between 0 and 999" });
      return;
    }
  }

  // Check slug uniqueness
  const { data: existing } = await ctx.admin
    .from("pages")
    .select("id")
    .eq("slug", slug)
    .single();

  if (existing) {
    res.status(409).json({ error: "Slug already in use" });
    return;
  }

  // Build page record
  const pageRecord: Database["public"]["Tables"]["pages"]["Insert"] = {
    slug,
    published: published === true,
    show_in_header: show_in_header === true,
    show_in_footer: show_in_footer === true,
    sort_order: sort_order != null ? Number(sort_order) : 0,
  };

  const { data: newPage, error: createError } = await ctx.admin
    .from("pages")
    .insert(pageRecord)
    .select("*")
    .single();

  if (createError) {
    req.log.error({ error: createError }, "Failed to create page");
    // Check if it's a unique constraint violation from the DB level
    if (createError.code === "23505") {
      res.status(409).json({ error: "Slug already in use" });
      return;
    }
    res.status(500).json({ error: "Failed to create page" });
    return;
  }

  // Write audit log (fire-and-forget — don't block response)
  writeAudit({
    admin: ctx.admin, req,
    actorId: ctx.user.id, action: "create_page", entityType: "pages", entityId: newPage.id,
    details: {
      slug,
      published: pageRecord.published,
      sort_order: pageRecord.sort_order,
      show_in_header: pageRecord.show_in_header,
      show_in_footer: pageRecord.show_in_footer,
    },
  });

  res.status(201).json(newPage);
});

/**
 * PATCH /api/admin/pages/:id
 * Admin-only — update page metadata (published, sort_order, show_in_header, show_in_footer, slug).
 * Updates updated_at via DB trigger.
 */
router.patch("/admin/pages/:id", requireAdmin, async (req, res): Promise<void> => {
  const ctx = { admin: req.admin!, user: req.user! };

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = rawId;

  // Fetch existing page
  const { data: existingPage, error: fetchError } = await ctx.admin
    .from("pages")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existingPage) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  const updates: Database["public"]["Tables"]["pages"]["Update"] = {};
  const changes: Record<string, Json | undefined> = {};

  // Handle slug update
  if (req.body.slug != null) {
    const slug = req.body.slug;
    if (typeof slug !== "string" || slug.length === 0) {
      res.status(400).json({ error: "Slug is required" });
      return;
    }
    if (slug.length > 100) {
      res.status(400).json({ error: "Slug must be at most 100 characters" });
      return;
    }
    if (!SLUG_REGEX.test(slug)) {
      res.status(400).json({ error: "Slug must match pattern: lowercase alphanumeric segments separated by hyphens" });
      return;
    }

    // Check uniqueness if slug is changing
    if (slug !== existingPage.slug) {
      const { data: slugExists } = await ctx.admin
        .from("pages")
        .select("id")
        .eq("slug", slug)
        .neq("id", id)
        .single();

      if (slugExists) {
        res.status(409).json({ error: "Slug already in use" });
        return;
      }
    }
    updates.slug = slug;
    changes.slug = slug;
  }

  // Handle published
  if (req.body.published != null) {
    updates.published = req.body.published === true;
    changes.published = updates.published;
  }

  // Handle sort_order
  if (req.body.sort_order != null) {
    const order = Number(req.body.sort_order);
    if (!Number.isInteger(order) || order < 0 || order > 999) {
      res.status(400).json({ error: "sort_order must be an integer between 0 and 999" });
      return;
    }
    updates.sort_order = order;
    changes.sort_order = order;
  }

  // Handle show_in_header
  if (req.body.show_in_header != null) {
    updates.show_in_header = req.body.show_in_header === true;
    changes.show_in_header = updates.show_in_header;
  }

  // Handle show_in_footer
  if (req.body.show_in_footer != null) {
    updates.show_in_footer = req.body.show_in_footer === true;
    changes.show_in_footer = updates.show_in_footer;
  }

  // Handle title validation (if passed for metadata purposes)
  if (req.body.title != null) {
    if (typeof req.body.title === "string" && req.body.title.length > 200) {
      res.status(400).json({ error: "Title must be at most 200 characters" });
      return;
    }
  }

  // Handle body validation (if passed for metadata purposes)
  if (req.body.body != null) {
    if (typeof req.body.body === "string" && req.body.body.length > 50000) {
      res.status(400).json({ error: "Body must be at most 50,000 characters" });
      return;
    }
  }

  if (Object.keys(updates).length === 0) {
    // No recognized updates — return existing page unchanged
    res.json(existingPage);
    return;
  }

  // Set updated_at explicitly to ensure it updates in the same logical operation
  updates.updated_at = new Date().toISOString();

  const { data: updatedPage, error: updateError } = await ctx.admin
    .from("pages")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    req.log.error({ error: updateError }, "Failed to update page");
    if (updateError.code === "23505") {
      res.status(409).json({ error: "Slug already in use" });
      return;
    }
    res.status(500).json({ error: "Failed to update page" });
    return;
  }

  // Write audit log (fire-and-forget — don't block response)
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "update_page", entityType: "pages", entityId: id as string, details: changes });

  res.json(updatedPage);
});

/**
 * DELETE /api/admin/pages/:id
 * Admin-only — delete a page. Rejects deletion of system pages (is_system = true).
 */
router.delete("/admin/pages/:id", requireAdmin, async (req, res): Promise<void> => {
  const ctx = { admin: req.admin!, user: req.user! };

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = rawId;

  // Fetch the page to check if it's a system page
  const { data: page, error: fetchError } = await ctx.admin
    .from("pages")
    .select("id, slug, is_system")
    .eq("id", id)
    .single();

  if (fetchError || !page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  if (page.is_system) {
    res.status(400).json({ error: "System pages cannot be deleted" });
    return;
  }

  const { error: deleteError } = await ctx.admin
    .from("pages")
    .delete()
    .eq("id", id);

  if (deleteError) {
    req.log.error({ error: deleteError }, "Failed to delete page");
    res.status(500).json({ error: "Failed to delete page" });
    return;
  }

  // Write audit log (fire-and-forget — don't block response)
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "delete_page", entityType: "pages", entityId: id as string, details: { slug: page.slug } });

  res.status(204).send();
});

/**
 * PUT /api/admin/pages/:id/translations/:locale
 * Admin-only — upsert a page translation for the given locale.
 * Validates title, content size, meta_title, meta_description.
 */
router.put("/admin/pages/:id/translations/:locale", requireAdmin, async (req, res): Promise<void> => {
  const ctx = { admin: req.admin!, user: req.user! };

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawLocale = Array.isArray(req.params.locale) ? req.params.locale[0] : req.params.locale;
  const id = rawId;
  const locale = rawLocale;

  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale as Locale)) {
    res.status(400).json({ error: `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(", ")}` });
    return;
  }

  // Verify page exists
  const { data: page, error: pageError } = await ctx.admin
    .from("pages")
    .select("id")
    .eq("id", id)
    .single();

  if (pageError || !page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  const { title, content, meta_title, meta_description } = req.body;

  // Validate title (required, max 200 chars)
  if (typeof title !== "string" || title.length === 0) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  if (title.length > 200) {
    res.status(400).json({ error: "Title must be at most 200 characters" });
    return;
  }

  // Validate content size (max 500 KB)
  if (content != null && typeof content === "string" && Buffer.byteLength(content, "utf-8") > 500 * 1024) {
    res.status(400).json({ error: "Content must not exceed 500 KB" });
    return;
  }

  // Validate meta_title (max 160 chars)
  if (meta_title != null && typeof meta_title === "string" && meta_title.length > 160) {
    res.status(400).json({ error: "meta_title must be at most 160 characters" });
    return;
  }

  // Validate meta_description (max 500 chars)
  if (meta_description != null && typeof meta_description === "string" && meta_description.length > 500) {
    res.status(400).json({ error: "meta_description must be at most 500 characters" });
    return;
  }

  // Sanitize HTML content using sanitize-html (Requirements 7.3)
  const sanitizedContent = content != null && typeof content === "string"
    ? sanitizeHtml(content, SANITIZE_CONFIG)
    : "";

  // Upsert the translation
  const translationRecord: Database["public"]["Tables"]["page_translations"]["Insert"] = {
    page_id: id,
    locale,
    title,
    content: sanitizedContent,
    meta_title: meta_title ?? null,
    meta_description: meta_description ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data: translation, error: upsertError } = await ctx.admin
    .from("page_translations")
    .upsert(translationRecord, { onConflict: "page_id,locale" })
    .select("*")
    .single();

  if (upsertError) {
    req.log.error({ error: upsertError }, "Failed to upsert page translation");
    res.status(500).json({ error: "Failed to save translation" });
    return;
  }

  // Update parent page's updated_at timestamp (Requirement 13.3)
  const { error: pageUpdateError } = await ctx.admin
    .from("pages")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  if (pageUpdateError) {
    req.log.error({ error: pageUpdateError }, "Failed to update parent page updated_at");
    // Non-blocking — translation was saved successfully
  }

  // Write audit log (fire-and-forget — don't block response)
  writeAudit({
    admin: ctx.admin, req,
    actorId: ctx.user.id, action: "upsert_page_translation", entityType: "page_translations", entityId: id as string,
    details: {
      locale,
      title,
      content: content != null ? "(updated)" : undefined,
      meta_title: meta_title ?? undefined,
      meta_description: meta_description ?? undefined,
    },
  });

  res.json(translation);
});

export default router;
