import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAdminList } from "@/lib/hooks/useAdminList";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

interface PlanRow {
  id: string;
  name: string;
  price: string;
  billing_interval: string;
  archived: boolean;
  feature_flags: Record<string, boolean>;
  quota_limits: Record<string, number>;
}

interface PlanFormData {
  name: string;
  price: string;
  billing_interval: string;
  feature_flags: string;
  quota_limits: string;
}

const EMPTY_FORM: PlanFormData = {
  name: "",
  price: "",
  billing_interval: "monthly",
  feature_flags: "{}",
  quota_limits: "{}",
};

export default function PlansPage() {
  const { t } = useI18n();
  const { confirm, dialogProps } = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanFormData>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetcher = useCallback(
    async (args: { offset: number; limit: number; search: string; signal: AbortSignal }) => {
      const params = new URLSearchParams();
      const page = Math.floor(args.offset / args.limit) + 1;
      params.set("page", String(page));
      params.set("pageSize", String(args.limit));

      const res = await fetch(apiUrl(`/platform/plans?${params.toString()}`), {
        signal: args.signal,
      });
      if (!res.ok) throw new Error(`Failed to fetch plans: ${res.status}`);
      const json = await res.json();
      return { rows: json.data as PlanRow[], count: json.total as number };
    },
    [],
  );

  const { rows, count, loading, page, totalPages } = useAdminList<PlanRow>({
    fetcher,
    basePath: "/platform/plans",
    pageSize: PAGE_SIZE,
  });

  const buildHref = (p: number) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    const qs = ps.toString();
    return `/platform/plans${qs ? `?${qs}` : ""}`;
  };

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(row: PlanRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      price: row.price,
      billing_interval: row.billing_interval,
      feature_flags: JSON.stringify(row.feature_flags, null, 2),
      quota_limits: JSON.stringify(row.quota_limits, null, 2),
    });
    setFormError("");
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    let feature_flags: Record<string, boolean>;
    let quota_limits: Record<string, number>;
    try {
      feature_flags = JSON.parse(form.feature_flags);
    } catch {
      setFormError(t("Platform.plans.invalidJson"));
      return;
    }
    try {
      quota_limits = JSON.parse(form.quota_limits);
    } catch {
      setFormError(t("Platform.plans.invalidJson"));
      return;
    }

    const body = {
      name: form.name.trim(),
      price: form.price,
      billing_interval: form.billing_interval,
      feature_flags,
      quota_limits,
    };

    setSubmitting(true);
    try {
      const url = editingId
        ? apiUrl(`/platform/plans/${editingId}`)
        : apiUrl("/platform/plans");
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        setFormError(err.error ?? `Error ${res.status}`);
        return;
      }

      setFormOpen(false);
      window.location.reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive(row: PlanRow) {
    confirm({
      title: t("Platform.plans.archiveConfirmTitle"),
      message: t("Platform.plans.archiveConfirmMessage"),
      destructive: true,
      onConfirm: async () => {
        await fetch(apiUrl(`/platform/plans/${row.id}/archive`), { method: "POST" });
        window.location.reload();
      },
    });
  }

  async function handleDelete(row: PlanRow) {
    confirm({
      title: t("Platform.plans.deleteConfirmTitle"),
      message: t("Platform.plans.deleteConfirmMessage"),
      destructive: true,
      onConfirm: async () => {
        await fetch(apiUrl(`/platform/plans/${row.id}`), { method: "DELETE" });
        window.location.reload();
      },
    });
  }

  const columns: Column<PlanRow>[] = [
    {
      key: "name",
      header: t("Platform.plans.name"),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "price",
      header: t("Platform.plans.price"),
      align: "right",
      cell: (row) => row.price,
    },
    {
      key: "billing_interval",
      header: t("Platform.plans.billingInterval"),
      cell: (row) => row.billing_interval,
    },
    {
      key: "archived",
      header: t("Platform.plans.archived"),
      cell: (row) => (
        <span
          className={cn(
            "px-2 py-0.5 rounded-full text-xs font-medium",
            row.archived
              ? "bg-yellow-100 text-yellow-800"
              : "bg-green-100 text-green-800",
          )}
        >
          {row.archived ? t("Platform.plans.yes") : t("Platform.plans.no")}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => openEdit(row)}
            className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
            aria-label={`${t("Platform.plans.edit")} ${row.name}`}
          >
            {t("Platform.plans.edit")}
          </button>
          {!row.archived && (
            <button
              onClick={() => handleArchive(row)}
              className="text-xs text-yellow-700 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
              aria-label={`${t("Platform.plans.archive")} ${row.name}`}
            >
              {t("Platform.plans.archive")}
            </button>
          )}
          <button
            onClick={() => handleDelete(row)}
            className="text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
            aria-label={`${t("Platform.plans.delete")} ${row.name}`}
          >
            {t("Platform.plans.delete")}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("Platform.plans.title")}</h1>
        <button
          onClick={openCreate}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {t("Platform.plans.create")}
        </button>
      </div>

      <DataTable<PlanRow>
        columns={columns}
        rows={rows}
        loading={loading}
        getRowKey={(row) => row.id}
        empty={
          <TableEmptyState
            colSpan={5}
            message={t("Platform.plans.empty")}
          />
        }
      />

      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />

      {/* Create/Edit Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-lg">
            <h2 className="text-lg font-semibold mb-4">
              {editingId ? t("Platform.plans.editTitle") : t("Platform.plans.createTitle")}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("Platform.plans.name")}
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                  maxLength={120}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("Platform.plans.price")}
                </label>
                <input
                  type="text"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("Platform.plans.billingInterval")}
                </label>
                <select
                  value={form.billing_interval}
                  onChange={(e) => setForm((f) => ({ ...f, billing_interval: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="monthly">{t("Platform.plans.monthly")}</option>
                  <option value="yearly">{t("Platform.plans.yearly")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("Platform.plans.featureFlags")}
                </label>
                <textarea
                  value={form.feature_flags}
                  onChange={(e) => setForm((f) => ({ ...f, feature_flags: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={3}
                  placeholder='{"feature_a": true}'
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("Platform.plans.quotaLimits")}
                </label>
                <textarea
                  value={form.quota_limits}
                  onChange={(e) => setForm((f) => ({ ...f, quota_limits: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={3}
                  placeholder='{"products": 100}'
                />
              </div>

              {formError && (
                <p className="text-destructive text-xs">{formError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {t("Platform.plans.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {submitting
                    ? t("Common.loading")
                    : editingId
                      ? t("Platform.plans.save")
                      : t("Platform.plans.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
