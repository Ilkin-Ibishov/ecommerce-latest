import { useEffect, useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n/context";
import { EditorToolbar } from "@/components/admin/page-editor/EditorToolbar";
import { ToggleSwitch } from "@/components/admin/page-editor/ToggleSwitch";

// ─── Types ────────────────────────────────────────────────────────────────────

type Locale = "az" | "ru" | "en";

interface PageTranslation {
  id?: string;
  locale: Locale;
  title: string;
  content: string;
  meta_title: string;
  meta_description: string;
}

interface PageData {
  id: string;
  slug: string;
  is_system: boolean;
  published: boolean;
  show_in_header: boolean;
  show_in_footer: boolean;
  sort_order: number;
  page_translations: Array<{
    id: string;
    locale: string;
    title: string;
    content?: string;
    meta_title?: string;
    meta_description?: string;
  }>;
}

const LOCALES: Locale[] = ["az", "ru", "en"];
const LOCALE_LABELS: Record<Locale, string> = { az: "Azərbaycan", ru: "Русский", en: "English" };

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PageEditorPage({ pageId }: { pageId: string }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<PageData | null>(null);
  const [activeLocale, setActiveLocale] = useState<Locale>("az");

  // Per-locale translation state
  const [translations, setTranslations] = useState<Record<Locale, PageTranslation>>({
    az: { locale: "az", title: "", content: "", meta_title: "", meta_description: "" },
    ru: { locale: "ru", title: "", content: "", meta_title: "", meta_description: "" },
    en: { locale: "en", title: "", content: "", meta_title: "", meta_description: "" },
  });

  // Page-level metadata
  const [showInHeader, setShowInHeader] = useState(false);
  const [showInFooter, setShowInFooter] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ slug?: string; title?: string }>({});

  const isNew = pageId === "new";

  /** Convert a title string to a URL-friendly slug */
  const generateSlug = (text: string): string => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "") // remove non-word chars except spaces/hyphens
      .replace(/\s+/g, "-")     // spaces → hyphens
      .replace(/-+/g, "-")      // collapse multiple hyphens
      .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
  };

  // TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      ImageExtension.configure({
        inline: false,
        allowBase64: false,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[300px] p-4 focus:outline-none",
      },
    },
  });

  // ─── Load page data ───────────────────────────────────────────────────────

  const loadPage = useCallback(async () => {
    if (pageId === "new") {
      setLoading(false);
      return;
    }

    try {
      // Fetch page with translations (admin endpoint returns full translations)
      const data = await adminJson(apiUrl(`/admin/pages`));
      const found = (data ?? []).find((p: PageData) => p.id === pageId);
      if (!found) {
        toast({ title: "Error", description: "Page not found", variant: "destructive" });
        navigate("/admin/pages");
        return;
      }
      setPage(found);
      setShowInHeader(found.show_in_header);
      setShowInFooter(found.show_in_footer);
      setSlug(found.slug);

      // Load full translations for each locale
      const translationMap: Record<Locale, PageTranslation> = {
        az: { locale: "az", title: "", content: "", meta_title: "", meta_description: "" },
        ru: { locale: "ru", title: "", content: "", meta_title: "", meta_description: "" },
        en: { locale: "en", title: "", content: "", meta_title: "", meta_description: "" },
      };

      // Fetch detailed translation content for each existing locale
      for (const t of found.page_translations ?? []) {
        const locale = t.locale as Locale;
        if (LOCALES.includes(locale)) {
          // Fetch complete translation with content
          try {
            const fullPage = await adminJson(
              apiUrl(`/pages/${found.slug}?locale=${locale}`)
            );
            if (fullPage?.translation) {
              translationMap[locale] = {
                locale,
                title: fullPage.translation.title ?? "",
                content: fullPage.translation.content ?? "",
                meta_title: fullPage.translation.meta_title ?? "",
                meta_description: fullPage.translation.meta_description ?? "",
              };
            }
          } catch {
            // If fetching this locale fails, use whatever we have from the list
            translationMap[locale] = {
              locale,
              title: t.title ?? "",
              content: "",
              meta_title: "",
              meta_description: "",
            };
          }
        }
      }

      setTranslations(translationMap);

      // Set editor content to the active locale's content
      if (editor) {
        editor.commands.setContent(translationMap["az"].content || "");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [pageId, navigate, editor]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  // ─── Sync editor content on locale tab change ─────────────────────────────

  const switchLocale = useCallback(
    (newLocale: Locale) => {
      if (!editor) return;

      // Save current editor content to the current locale
      const currentContent = editor.getHTML();
      setTranslations((prev) => ({
        ...prev,
        [activeLocale]: { ...prev[activeLocale], content: currentContent },
      }));

      // Switch to new locale and load its content
      setActiveLocale(newLocale);
      setTranslations((prev) => {
        const newContent = prev[newLocale].content;
        editor.commands.setContent(newContent || "");
        return prev;
      });
    },
    [editor, activeLocale]
  );

  // ─── Save handler ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    // Clear previous validation errors
    setValidationErrors({});

    // Capture the current editor content into translation state
    const currentContent = editor?.getHTML() ?? "";
    const currentTranslations = {
      ...translations,
      [activeLocale]: { ...translations[activeLocale], content: currentContent },
    };
    setTranslations(currentTranslations);

    // ─── Validation (before setting saving state) ───────────────────────
    const errors: { slug?: string; title?: string } = {};

    if (isNew) {
      // Auto-generate slug from title if still empty
      let trimmedSlug = slug.trim();
      if (!trimmedSlug && currentTranslations.az.title) {
        trimmedSlug = generateSlug(currentTranslations.az.title);
        setSlug(trimmedSlug);
      }
      if (!trimmedSlug && currentTranslations[activeLocale].title) {
        trimmedSlug = generateSlug(currentTranslations[activeLocale].title);
        setSlug(trimmedSlug);
      }

      if (!trimmedSlug) {
        errors.slug = t("Admin.PageEditor.slugRequired");
      } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmedSlug)) {
        errors.slug = t("Admin.PageEditor.slugInvalid");
      }
    }

    // Title is required for the active locale
    const activeTitle = currentTranslations[activeLocale].title.trim();
    if (!activeTitle) {
      errors.title = t("Admin.PageEditor.titleRequired");
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      toast({
        title: t("Admin.PageEditor.validationFailed"),
        description: Object.values(errors).join(" "),
        variant: "destructive",
      });
      return;
    }

    // ─── Proceed with save ──────────────────────────────────────────────
    setSaving(true);

    try {
      // Resolve the page ID — create the page first if this is a new page
      let targetPageId = page?.id;

      if (isNew) {
        const trimmedSlug = slug.trim();

        const created = await adminJson(apiUrl("/admin/pages"), {
          method: "POST",
          body: JSON.stringify({
            slug: trimmedSlug,
            published: false,
            show_in_header: showInHeader,
            show_in_footer: showInFooter,
          }),
        });
        targetPageId = created.id;
        setPage(created);
      } else {
        // Save page-level metadata for existing pages
        await adminJson(apiUrl(`/admin/pages/${targetPageId}`), {
          method: "PATCH",
          body: JSON.stringify({
            show_in_header: showInHeader,
            show_in_footer: showInFooter,
          }),
        });
      }

      // Save the active locale's translation
      const tr = currentTranslations[activeLocale];
      await adminJson(apiUrl(`/admin/pages/${targetPageId}/translations/${activeLocale}`), {
        method: "PUT",
        body: JSON.stringify({
          title: tr.title || "Untitled",
          content: tr.content,
          meta_title: tr.meta_title || null,
          meta_description: tr.meta_description || null,
        }),
      });

      toast({ title: t("Admin.PageEditor.saved"), description: t("Admin.PageEditor.savedDescription").replace("{locale}", LOCALE_LABELS[activeLocale]) });

      // After creating a new page, navigate to its edit URL
      if (isNew && targetPageId) {
        navigate(`/admin/pages/${targetPageId}/edit`);
      }
    } catch (err: any) {
      toast({ title: t("Admin.PageEditor.validationFailed"), description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ─── Field helpers ────────────────────────────────────────────────────────

  const updateField = (field: keyof PageTranslation, value: string) => {
    setTranslations((prev) => ({
      ...prev,
      [activeLocale]: { ...prev[activeLocale], [field]: value },
    }));
  };

  // ─── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  if (!page && pageId !== "new") {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>{t("Admin.PageEditor.notFound")}</p>
        <Link href="/admin/pages" className="text-primary underline mt-2 inline-block">
          {t("Admin.PageEditor.backToPages")}
        </Link>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const currentTranslation = translations[activeLocale];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/pages"
            className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              {page ? t("Admin.PageEditor.editPage").replace("{slug}", page.slug) : t("Admin.PageEditor.newPage")}
            </h1>
            {page?.is_system && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 mt-1">
                {t("Admin.PageEditor.systemPage")}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? t("Admin.Common.saving") : t("Admin.Common.save")}
        </button>
      </div>

      {/* Slug (new pages only) */}
      {isNew && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wide">
            {t("Admin.PageEditor.pageSlug")}
          </h2>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
              setSlugManuallyEdited(true);
              setValidationErrors((prev) => ({ ...prev, slug: undefined }));
            }}
            placeholder={t("Admin.PageEditor.slugPlaceholder")}
            className={`w-full px-3 py-2 rounded-lg border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring ${
              validationErrors.slug ? "border-destructive" : "border-border"
            }`}
          />
          {validationErrors.slug ? (
            <p className="text-destructive text-xs mt-1">{validationErrors.slug}</p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              {t("Admin.PageEditor.slugHint").replace("{slug}", slug || "your-slug")}
            </p>
          )}
        </div>
      )}

      {/* Navigation Toggles */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wide">
          {t("Admin.PageEditor.navigationPlacement")}
        </h2>
        <div className="flex gap-6">
          <ToggleSwitch
            label={t("Admin.PageEditor.showInHeader")}
            checked={showInHeader}
            onChange={setShowInHeader}
          />
          <ToggleSwitch
            label={t("Admin.PageEditor.showInFooter")}
            checked={showInFooter}
            onChange={setShowInFooter}
          />
        </div>
      </div>

      {/* Locale Tabs */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border">
          {LOCALES.map((locale) => (
            <button
              key={locale}
              onClick={() => switchLocale(locale)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeLocale === locale
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              }`}
            >
              {LOCALE_LABELS[locale]}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {/* Title field */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">{t("Admin.PageEditor.title")}</label>
            <input
              type="text"
              value={currentTranslation.title}
              onChange={(e) => {
                updateField("title", e.target.value);
                setValidationErrors((prev) => ({ ...prev, title: undefined }));
                // Auto-generate slug from the az title for new pages
                if (isNew && activeLocale === "az" && !slugManuallyEdited) {
                  setSlug(generateSlug(e.target.value));
                  setValidationErrors((prev) => ({ ...prev, slug: undefined }));
                }
              }}
              maxLength={200}
              placeholder={t("Admin.PageEditor.titlePlaceholder")}
              className={`w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                validationErrors.title ? "border-destructive" : "border-border"
              }`}
            />
            {validationErrors.title && (
              <p className="text-destructive text-xs mt-1">{validationErrors.title}</p>
            )}
          </div>

          {/* TipTap Editor */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">{t("Admin.PageEditor.content")}</label>
            <div className="border border-border rounded-lg overflow-hidden bg-background">
              <EditorToolbar editor={editor} />
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>

      {/* SEO Fields */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          {t("Admin.PageEditor.seo")}
        </h2>

        <div className="space-y-1">
          <label className="block text-sm font-medium">{t("Admin.PageEditor.metaTitle")}</label>
          <input
            type="text"
            value={currentTranslation.meta_title}
            onChange={(e) => updateField("meta_title", e.target.value)}
            maxLength={160}
            placeholder={t("Admin.PageEditor.metaTitlePlaceholder")}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            {t("Admin.PageEditor.metaTitleCount").replace("{count}", String(currentTranslation.meta_title.length))}
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">{t("Admin.PageEditor.metaDescription")}</label>
          <textarea
            value={currentTranslation.meta_description}
            onChange={(e) => updateField("meta_description", e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t("Admin.PageEditor.metaDescPlaceholder")}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <p className="text-xs text-muted-foreground">
            {t("Admin.PageEditor.metaDescCount").replace("{count}", String(currentTranslation.meta_description.length))}
          </p>
        </div>
      </div>
    </div>
  );
}
