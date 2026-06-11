import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import { adminFetch, adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface PageTranslation {
  id: string;
  locale: string;
  title: string;
}

interface PageItem {
  id: string;
  slug: string;
  is_system: boolean;
  published: boolean;
  show_in_header: boolean;
  show_in_footer: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  page_translations: PageTranslation[];
}

function getTitle(translations: PageTranslation[]): string {
  return (
    translations.find((t) => t.locale === "az")?.title ??
    translations[0]?.title ??
    "Untitled"
  );
}

export default function PagesPage() {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<PageItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const sortTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const load = async () => {
    try {
      const data = await adminJson(apiUrl("/admin/pages"));
      setPages(data ?? []);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => {
      // Cleanup debounce timers on unmount
      sortTimers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const handleTogglePublished = async (page: PageItem) => {
    const newValue = !page.published;
    // Optimistic update
    setPages((prev) =>
      prev.map((p) => (p.id === page.id ? { ...p, published: newValue } : p))
    );
    try {
      await adminJson(apiUrl(`/admin/pages/${page.id}`), {
        method: "PATCH",
        body: JSON.stringify({ published: newValue }),
      });
      toast({
        title: "Updated",
        description: `"${getTitle(page.page_translations)}" is now ${newValue ? "published" : "unpublished"}.`,
      });
    } catch (err: any) {
      // Revert optimistic update
      setPages((prev) =>
        prev.map((p) => (p.id === page.id ? { ...p, published: !newValue } : p))
      );
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleSortOrderChange = useCallback((page: PageItem, value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue < 0 || numValue > 999) return;

    // Update local state immediately
    setPages((prev) =>
      prev.map((p) => (p.id === page.id ? { ...p, sort_order: numValue } : p))
    );

    // Debounce the API call (persist within 2 seconds)
    const existing = sortTimers.current.get(page.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      sortTimers.current.delete(page.id);
      try {
        await adminJson(apiUrl(`/admin/pages/${page.id}`), {
          method: "PATCH",
          body: JSON.stringify({ sort_order: numValue }),
        });
        toast({ title: "Sort order updated", description: `"${getTitle(page.page_translations)}" → ${numValue}` });
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    }, 1500);

    sortTimers.current.set(page.id, timer);
  }, []);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await adminFetch(apiUrl(`/admin/pages/${deleteConfirm.id}`), { method: "DELETE" });
      toast({ title: "Deleted", description: `"${getTitle(deleteConfirm.page_translations)}" has been deleted.` });
      setDeleteConfirm(null);
      await load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pages</h1>
        <Link
          href="/admin/pages/new/edit"
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition"
        >
          <Plus size={16} /> Create Page
        </Link>
      </div>

      {/* Table */}
      {pages.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl text-muted-foreground">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>No pages yet. Create your first content page.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Title</th>
                  <th className="text-left px-4 py-3 font-medium">Slug</th>
                  <th className="text-center px-4 py-3 font-medium">Published</th>
                  <th className="text-center px-4 py-3 font-medium">Header</th>
                  <th className="text-center px-4 py-3 font-medium">Footer</th>
                  <th className="text-center px-4 py-3 font-medium">Order</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => {
                  const title = getTitle(page.page_translations);
                  return (
                    <tr
                      key={page.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition"
                    >
                      {/* Title + System badge */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{title}</span>
                          {page.is_system && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20">
                              System
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Slug */}
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                        /{page.slug}
                      </td>

                      {/* Published toggle */}
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleTogglePublished(page)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            page.published ? "bg-green-500" : "bg-muted-foreground/30"
                          }`}
                          aria-label={`Toggle published for ${title}`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                              page.published ? "translate-x-[18px]" : "translate-x-[3px]"
                            }`}
                          />
                        </button>
                      </td>

                      {/* Show in Header */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            page.show_in_header ? "bg-green-500" : "bg-muted-foreground/30"
                          }`}
                        />
                      </td>

                      {/* Show in Footer */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            page.show_in_footer ? "bg-green-500" : "bg-muted-foreground/30"
                          }`}
                        />
                      </td>

                      {/* Sort Order (editable) */}
                      <td className="px-4 py-3 text-center">
                        <input
                          type="number"
                          min={0}
                          max={999}
                          value={page.sort_order}
                          onChange={(e) => handleSortOrderChange(page, e.target.value)}
                          className="w-16 text-center px-2 py-1 rounded border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/admin/pages/${page.id}/edit`}
                            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </Link>
                          {!page.is_system && (
                            <button
                              onClick={() => setDeleteConfirm(page)}
                              className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-background border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <h2 className="font-bold text-lg">Delete Page</h2>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete "{getTitle(deleteConfirm.page_translations)}"?
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 bg-destructive text-destructive-foreground rounded-lg font-medium hover:bg-destructive/90 transition disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-5 py-2.5 bg-muted/50 text-muted-foreground rounded-lg hover:bg-muted transition text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
