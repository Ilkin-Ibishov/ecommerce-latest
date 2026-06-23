import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, ImageIcon, ArrowUp, ArrowDown } from "lucide-react";
import { adminFetch, adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n/context";
import { useAdminList } from "@/lib/hooks/useAdminList";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useConfirm } from "@/lib/hooks/useConfirm";

interface BrandEntry {
  id: string;
  name: string;
  logo_url: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Admin brand management page. Uses useAdminList + DataTable pattern.
 * Provides CRUD operations for brand entries and a global brand banner toggle.
 */
export default function BrandsPage() {
  const { t } = useI18n();
  const { confirm, dialogProps } = useConfirm();

  // Brand banner toggle state
  const [bannerEnabled, setBannerEnabled] = useState(true);
  const [bannerLoading, setBannerLoading] = useState(true);
  const [togglingBanner, setTogglingBanner] = useState(false);

  // Fetch brand_banner_enabled setting on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(apiUrl("/admin/settings"));
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const setting = Array.isArray(data)
          ? data.find((s: { key: string }) => s.key === "brand_banner_enabled")
          : null;
        if (setting) {
          setBannerEnabled(setting.value === "true");
        }
      } catch {
        // Keep default (enabled)
      } finally {
        if (!cancelled) setBannerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Toggle brand banner setting
  const handleBannerToggle = async () => {
    const newValue = !bannerEnabled;
    setTogglingBanner(true);
    try {
      await adminJson(apiUrl("/admin/settings"), {
        method: "PATCH",
        body: JSON.stringify({ brand_banner_enabled: newValue ? "true" : "false" }),
      });
      setBannerEnabled(newValue);
    } catch {
      // Revert on failure - state stays unchanged
    } finally {
      setTogglingBanner(false);
    }
  };

  // Track refresh trigger to force re-fetch after mutations
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  // Reorder state: track local order of brand IDs
  const [reorderIds, setReorderIds] = useState<string[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  // Fetcher for useAdminList
  const fetcher = useCallback(
    async (args: { offset: number; limit: number; search: string; signal: AbortSignal }) => {
      const res = await adminFetch(apiUrl("/admin/brands"), { signal: args.signal });
      if (!res.ok) throw new Error("Failed to fetch brands");
      const data: BrandEntry[] = await res.json();
      // Client-side search filter (API returns all ordered by sort_order)
      const filtered = args.search
        ? data.filter((b) => b.name.toLowerCase().includes(args.search.toLowerCase()))
        : data;
      // Client-side pagination
      const rows = filtered.slice(args.offset, args.offset + args.limit);
      return { rows, count: filtered.length };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshKey],
  );

  const { rows, count, loading, page, totalPages, search, searchInput, setSearchInput } =
    useAdminList<BrandEntry>({
      fetcher,
      basePath: "/admin/brands",
      pageSize: 30,
    });

  // Compute the displayed rows based on reorder state
  const displayRows = useMemo(() => {
    if (!reorderIds) return rows;
    // Reorder rows to match the local reorderIds
    const rowMap = new Map(rows.map((r) => [r.id, r]));
    return reorderIds
      .map((id) => rowMap.get(id))
      .filter((r): r is BrandEntry => r !== undefined);
  }, [rows, reorderIds]);

  // Determine whether order has changed from server state
  const orderChanged = useMemo(() => {
    if (!reorderIds) return false;
    const serverIds = rows.map((r) => r.id);
    if (reorderIds.length !== serverIds.length) return false;
    return reorderIds.some((id, i) => id !== serverIds[i]);
  }, [reorderIds, rows]);

  // Initialize reorderIds when rows change (from server)
  useEffect(() => {
    if (rows.length > 0 && !reorderIds) {
      setReorderIds(rows.map((r) => r.id));
    }
  }, [rows, reorderIds]);

  // Reset reorder state when rows refresh from server (e.g. after save)
  useEffect(() => {
    if (rows.length > 0) {
      setReorderIds(rows.map((r) => r.id));
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move a brand up or down in the local order
  const moveItem = (id: string, direction: "up" | "down") => {
    setReorderIds((prev) => {
      if (!prev) return prev;
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  };

  // Save the reordered IDs to the server
  const handleSaveOrder = async () => {
    if (!reorderIds || !orderChanged) return;
    setSavingOrder(true);
    try {
      await adminJson(apiUrl("/admin/brands/reorder"), {
        method: "PATCH",
        body: JSON.stringify({ ids: reorderIds }),
      });
      refresh();
    } catch {
      // Silently fail
    } finally {
      setSavingOrder(false);
    }
  };

  // Toggle is_active for a brand
  const toggleActive = async (brand: BrandEntry) => {
    try {
      await adminJson(apiUrl(`/admin/brands/${brand.id}`), {
        method: "PATCH",
        body: JSON.stringify({ is_active: !brand.is_active }),
      });
      refresh();
    } catch {
      // Silently fail
    }
  };

  // Delete brand
  const handleDelete = (brand: BrandEntry) => {
    confirm({
      title: t("Admin.Brands.delete"),
      message: t("Admin.Brands.confirmDelete"),
      destructive: true,
      onConfirm: async () => {
        try {
          await adminFetch(apiUrl(`/admin/brands/${brand.id}`), { method: "DELETE" });
          refresh();
        } catch {
          // Silently fail
        }
      },
    });
  };

  // Build pagination href
  const buildHref = (p: number) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (search) ps.set("q", search);
    const qs = ps.toString();
    return `/admin/brands${qs ? `?${qs}` : ""}`;
  };

  // DataTable columns
  const columns: Column<BrandEntry>[] = [
    {
      key: "logo",
      header: t("Admin.Brands.logo"),
      cell: (row) => (
        <div className="w-10 h-10 rounded bg-muted border border-border overflow-hidden flex items-center justify-center">
          {row.logo_url ? (
            <img
              src={row.logo_url}
              alt={row.name}
              className="w-full h-full object-contain p-1"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <ImageIcon size={16} className="text-muted-foreground/40" />
          )}
        </div>
      ),
      className: "w-16",
    },
    {
      key: "name",
      header: t("Admin.Brands.name"),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "status",
      header: t("Admin.Brands.status"),
      cell: (row) => (
        <button
          onClick={() => toggleActive(row)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
            row.is_active ? "bg-primary" : "bg-muted"
          }`}
          role="switch"
          aria-checked={row.is_active}
          aria-label={`${row.name} ${t("Admin.Brands.status")}`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              row.is_active ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      ),
      className: "w-24",
    },
    {
      key: "actions",
      header: t("Admin.Brands.actions"),
      cell: (row) => {
        const idx = reorderIds ? reorderIds.indexOf(row.id) : -1;
        const isFirst = idx === 0;
        const isLast = idx === (reorderIds ? reorderIds.length - 1 : 0);
        return (
          <div className="flex items-center gap-1">
            <button
              onClick={() => moveItem(row.id, "up")}
              disabled={isFirst}
              className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={`${t("Admin.Brands.moveUp")} ${row.name}`}
            >
              <ArrowUp size={15} />
            </button>
            <button
              onClick={() => moveItem(row.id, "down")}
              disabled={isLast}
              className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={`${t("Admin.Brands.moveDown")} ${row.name}`}
            >
              <ArrowDown size={15} />
            </button>
            <button
              onClick={() => handleEdit(row)}
              className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition"
              aria-label={`${t("Admin.Brands.edit")} ${row.name}`}
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={() => handleDelete(row)}
              className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
              aria-label={`${t("Admin.Brands.delete")} ${row.name}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      },
      className: "w-36",
    },
  ];

  // Edit/Add modal state
  const [editModal, setEditModal] = useState<{ open: boolean; brand: BrandEntry | null }>({
    open: false,
    brand: null,
  });
  const [editForm, setEditForm] = useState({ name: "", logo_url: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; logo_url?: string }>({});

  const handleEdit = (brand: BrandEntry) => {
    setEditForm({ name: brand.name, logo_url: brand.logo_url });
    setFieldErrors({});
    setEditModal({ open: true, brand });
  };

  const validateForm = (): boolean => {
    const errors: { name?: string; logo_url?: string } = {};
    const trimmedName = editForm.name.trim();
    if (!trimmedName || trimmedName.length < 1 || trimmedName.length > 100) {
      errors.name = t("Admin.Brands.nameExists");
    }
    const trimmedUrl = editForm.logo_url.trim();
    if (!trimmedUrl || (!trimmedUrl.startsWith("data:image/svg+xml") && !trimmedUrl.startsWith("https://"))) {
      errors.logo_url = t("Admin.Brands.invalidUrl");
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleEditSave = async () => {
    if (!validateForm()) return;
    setEditSaving(true);
    setFieldErrors({});
    try {
      let res: Response;
      if (editModal.brand) {
        res = await adminFetch(apiUrl(`/admin/brands/${editModal.brand.id}`), {
          method: "PATCH",
          body: JSON.stringify(editForm),
        });
      } else {
        res = await adminFetch(apiUrl("/admin/brands"), {
          method: "POST",
          body: JSON.stringify(editForm),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setFieldErrors({ name: t("Admin.Brands.nameExists") });
        } else if (res.status === 400) {
          const msg = data.error || "";
          if (msg.toLowerCase().includes("logo") || msg.toLowerCase().includes("url")) {
            setFieldErrors({ logo_url: t("Admin.Brands.invalidUrl") });
          } else if (msg.toLowerCase().includes("name")) {
            setFieldErrors({ name: data.error });
          } else {
            setFieldErrors({ name: data.error || t("Admin.Brands.invalidUrl") });
          }
        } else {
          setFieldErrors({ name: data.error || `Request failed (${res.status})` });
        }
        return;
      }
      setEditModal({ open: false, brand: null });
      refresh();
    } catch {
      setFieldErrors({ name: t("Admin.Brands.invalidUrl") });
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("Admin.Brands.title")}</h1>
        <button
          onClick={() => {
            setEditForm({ name: "", logo_url: "" });
            setFieldErrors({});
            setEditModal({ open: true, brand: null });
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition"
        >
          <Plus size={16} /> {t("Admin.Brands.addBrand")}
        </button>
      </div>

      {/* Brand Banner Toggle */}
      <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-medium">{t("Admin.Brands.showBanner")}</span>
        <button
          onClick={handleBannerToggle}
          disabled={bannerLoading || togglingBanner}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${
            bannerEnabled ? "bg-primary" : "bg-muted"
          }`}
          role="switch"
          aria-checked={bannerEnabled}
          aria-label={t("Admin.Brands.showBanner")}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              bannerEnabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Save Order Button */}
      {orderChanged && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
          <span className="text-sm text-muted-foreground flex-1">
            {t("Admin.Brands.orderChanged")}
          </span>
          <button
            onClick={handleSaveOrder}
            disabled={savingOrder}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
          >
            {savingOrder ? t("Admin.Brands.saveOrder") + "..." : t("Admin.Brands.saveOrder")}
          </button>
        </div>
      )}

      {/* Data Table */}
      <DataTable
        columns={columns}
        rows={displayRows}
        loading={loading}
        empty={
          <TableEmptyState
            message={t("Admin.Brands.emptyState")}
            colSpan={columns.length}
          />
        }
        getRowKey={(row) => row.id}
      />

      {/* Pagination */}
      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />

      {/* Edit/Add Modal */}
      {editModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-background border border-border rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-bold text-lg">
                {editModal.brand ? t("Admin.Brands.edit") : t("Admin.Brands.addBrand")}
              </h2>
              <button
                onClick={() => setEditModal({ open: false, brand: null })}
                className="p-2 rounded-lg hover:bg-accent transition"
                aria-label={t("Admin.Brands.cancel")}
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("Admin.Brands.brandName")}
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => {
                    setEditForm((f) => ({ ...f, name: e.target.value }));
                    setFieldErrors((errs) => ({ ...errs, name: undefined }));
                  }}
                  className={`w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                    fieldErrors.name ? "border-destructive" : "border-border"
                  }`}
                  placeholder={t("Admin.Brands.brandName")}
                />
                {fieldErrors.name && (
                  <p className="text-destructive text-xs mt-1">{fieldErrors.name}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("Admin.Brands.logoUrl")}
                </label>
                <input
                  type="text"
                  value={editForm.logo_url}
                  onChange={(e) => {
                    setEditForm((f) => ({ ...f, logo_url: e.target.value }));
                    setFieldErrors((errs) => ({ ...errs, logo_url: undefined }));
                  }}
                  className={`w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                    fieldErrors.logo_url ? "border-destructive" : "border-border"
                  }`}
                  placeholder={t("Admin.Brands.logoUrl")}
                />
                {fieldErrors.logo_url && (
                  <p className="text-destructive text-xs mt-1">{fieldErrors.logo_url}</p>
                )}
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition disabled:opacity-50"
              >
                {editSaving ? t("Admin.Brands.save") + "..." : t("Admin.Brands.save")}
              </button>
              <button
                onClick={() => setEditModal({ open: false, brand: null })}
                className="px-5 py-2.5 bg-muted/50 text-muted-foreground rounded-lg hover:bg-muted transition text-sm"
              >
                {t("Admin.Brands.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        {...dialogProps}
        confirmLabel={t("Admin.Brands.delete")}
        cancelLabel={t("Admin.Brands.cancel")}
      />
    </div>
  );
}
