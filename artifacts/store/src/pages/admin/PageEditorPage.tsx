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

// ─── Editor Toolbar ───────────────────────────────────────────────────────────

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const btnClass = (active: boolean) =>
    `px-2 py-1 rounded text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
    }`;

  const handleAddLink = () => {
    const href = window.prompt("Enter URL:");
    if (href) {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
  };

  const handleAddImage = () => {
    const src = window.prompt("Enter image URL:");
    if (src) {
      const alt = window.prompt("Enter alt text:") ?? "";
      editor.chain().focus().setImage({ src, alt }).run();
    }
  };

  return (
    <div className="flex flex-wrap gap-1 p-2 border-b border-border bg-muted/20 rounded-t-lg">
      {/* Headings */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={btnClass(editor.isActive("heading", { level: 2 }))}
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={btnClass(editor.isActive("heading", { level: 3 }))}
      >
        H3
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        className={btnClass(editor.isActive("heading", { level: 4 }))}
      >
        H4
      </button>

      <div className="w-px h-6 bg-border mx-1 self-center" />

      {/* Formatting */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btnClass(editor.isActive("bold"))}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btnClass(editor.isActive("italic"))}
      >
        <em>I</em>
      </button>

      <div className="w-px h-6 bg-border mx-1 self-center" />

      {/* Lists */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btnClass(editor.isActive("bulletList"))}
      >
        • List
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btnClass(editor.isActive("orderedList"))}
      >
        1. List
      </button>

      <div className="w-px h-6 bg-border mx-1 self-center" />

      {/* Link & Image */}
      <button
        type="button"
        onClick={handleAddLink}
        className={btnClass(editor.isActive("link"))}
      >
        Link
      </button>
      <button
        type="button"
        onClick={handleAddImage}
        className={btnClass(false)}
      >
        Image
      </button>
    </div>
  );
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-green-500" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PageEditorPage({ pageId }: { pageId: string }) {
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
    if (!page) return;
    setSaving(true);

    try {
      // First, save the current editor content to translation state
      const currentContent = editor?.getHTML() ?? "";
      const currentTranslations = {
        ...translations,
        [activeLocale]: { ...translations[activeLocale], content: currentContent },
      };
      setTranslations(currentTranslations);

      // Save page-level metadata (show_in_header, show_in_footer)
      await adminJson(apiUrl(`/admin/pages/${page.id}`), {
        method: "PATCH",
        body: JSON.stringify({
          show_in_header: showInHeader,
          show_in_footer: showInFooter,
        }),
      });

      // Save the active locale's translation
      const t = currentTranslations[activeLocale];
      await adminJson(apiUrl(`/admin/pages/${page.id}/translations/${activeLocale}`), {
        method: "PUT",
        body: JSON.stringify({
          title: t.title || "Untitled",
          content: t.content,
          meta_title: t.meta_title || null,
          meta_description: t.meta_description || null,
        }),
      });

      toast({ title: "Saved", description: `Translation for ${LOCALE_LABELS[activeLocale]} saved successfully.` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
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
        <p>Page not found.</p>
        <Link href="/admin/pages" className="text-primary underline mt-2 inline-block">
          Back to pages
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
              {page ? `Edit: ${page.slug}` : "New Page"}
            </h1>
            {page?.is_system && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 mt-1">
                System Page
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
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Navigation Toggles */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wide">
          Navigation Placement
        </h2>
        <div className="flex gap-6">
          <ToggleSwitch
            label="Show in header"
            checked={showInHeader}
            onChange={setShowInHeader}
          />
          <ToggleSwitch
            label="Show in footer"
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
            <label className="block text-sm font-medium">Title</label>
            <input
              type="text"
              value={currentTranslation.title}
              onChange={(e) => updateField("title", e.target.value)}
              maxLength={200}
              placeholder="Page title…"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* TipTap Editor */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Content</label>
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
          SEO
        </h2>

        <div className="space-y-1">
          <label className="block text-sm font-medium">Meta Title</label>
          <input
            type="text"
            value={currentTranslation.meta_title}
            onChange={(e) => updateField("meta_title", e.target.value)}
            maxLength={160}
            placeholder="SEO page title (max 160 characters)"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            {currentTranslation.meta_title.length}/160 characters
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">Meta Description</label>
          <textarea
            value={currentTranslation.meta_description}
            onChange={(e) => updateField("meta_description", e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="SEO description (max 500 characters)"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <p className="text-xs text-muted-foreground">
            {currentTranslation.meta_description.length}/500 characters
          </p>
        </div>
      </div>
    </div>
  );
}
