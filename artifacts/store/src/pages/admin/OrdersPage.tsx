import { useCallback } from "react";
import { Link, useSearch } from "wouter";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useAdminList } from "@/lib/hooks/useAdminList";
import { useI18n } from "@/lib/i18n/context";
import { getOrders, type OrderRow } from "@/lib/queries/orders";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { SearchInput } from "@/components/admin/SearchInput";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  phone_verified: "bg-blue-500/20 text-blue-400",
  courier_assigned: "bg-purple-500/20 text-purple-400",
  shipped: "bg-indigo-500/20 text-indigo-400",
  delivered: "bg-green-500/20 text-green-400",
  refused_at_delivery: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

const STATUSES = ["pending", "phone_verified", "courier_assigned", "shipped", "delivered", "refused_at_delivery", "cancelled"];

const STATUS_KEYS: Record<string, string> = {
  pending: "Admin.Orders.statusPending",
  phone_verified: "Admin.Orders.statusPhoneVerified",
  courier_assigned: "Admin.Orders.statusCourierAssigned",
  shipped: "Admin.Orders.statusShipped",
  delivered: "Admin.Orders.statusDelivered",
  refused_at_delivery: "Admin.Orders.statusRefusedAtDelivery",
  cancelled: "Admin.Orders.statusCancelled",
};

const PAGE_SIZE = 30;

/**
 * Orders list view. Keyed by the active status tab so a status change remounts
 * and refetches (the bound `status` filter is not a `useAdminList` input). The
 * hook owns URL-driven pagination + the 350 ms debounced search; the status-tab
 * filters, CSV export, columns, and URL query params (page/q/status) are
 * preserved exactly.
 */
function OrdersListView({ status }: { status: string }) {
  const { t } = useI18n();

  const fetcher = useCallback(
    (args: { offset: number; limit: number; search: string; signal: AbortSignal }) =>
      getOrders(createClient(), {
        offset: args.offset,
        limit: args.limit,
        search: args.search,
        status,
      }),
    [status],
  );

  const { rows, count, loading, page, totalPages, search, searchInput, setSearchInput } = useAdminList<OrderRow>({
    fetcher,
    basePath: "/admin/orders",
    pageSize: PAGE_SIZE,
  });

  // Preserves the prior URL-state behavior, including the `status` param:
  // page omitted when 1, status/q omitted when empty.
  const buildHref = (p: number, s?: string, q?: string) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (s) ps.set("status", s);
    if (q) ps.set("q", q);
    const qs = ps.toString();
    return `/admin/orders${qs ? `?${qs}` : ""}`;
  };

  // Column set / labels / cell rendering preserved byte-for-byte from the prior
  // hand-rolled table (R6.3, R6.5, R6.6).
  const columns: Column<OrderRow>[] = [
    {
      key: "order",
      header: t("Admin.Orders.columnOrder"),
      align: "left",
      cell: (o) => (
        <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs text-primary hover:underline">
          #{String(o.id).slice(0, 8).toUpperCase()}
        </Link>
      ),
    },
    {
      key: "customer",
      header: t("Admin.Orders.columnCustomer"),
      align: "left",
      cell: (o) => (
        <>
          <div className="font-medium">{o.customer_name}</div>
          <div className="text-xs text-muted-foreground">{o.customer_phone}</div>
        </>
      ),
    },
    {
      key: "address",
      header: t("Admin.Orders.columnAddress"),
      align: "left",
      className: "text-muted-foreground text-xs max-w-[160px] truncate",
      cell: (o) => o.delivery_address,
    },
    {
      key: "status",
      header: t("Admin.Orders.columnStatus"),
      align: "left",
      cell: (o) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] ?? "bg-muted text-muted-foreground"}`}>
          {STATUS_KEYS[o.status] ? t(STATUS_KEYS[o.status]) : String(o.status).replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "total",
      header: t("Admin.Orders.columnTotal"),
      align: "right",
      className: "font-medium",
      cell: (o) => `${Number(o.total_azn).toFixed(2)} AZN`,
    },
    {
      key: "date",
      header: t("Admin.Orders.columnDate"),
      align: "right",
      className: "text-muted-foreground text-xs",
      cell: (o) => new Date(o.created_at).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("Admin.Orders.title")}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {search
              ? t("Admin.Orders.resultCount").replace("{count}", String(count)).replace("{query}", search)
              : t("Admin.Orders.totalCount").replace("{count}", String(count))}
          </span>
          <button
            onClick={async () => {
              const ps = new URLSearchParams();
              if (status) ps.set("status", status);
              const res = await adminFetch(`${apiUrl("/admin/orders/export")}?${ps.toString()}`);
              if (!res.ok) return;
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition"
          >
            <Download size={13} /> {t("Admin.Orders.exportCsv")}
          </button>
        </div>
      </div>

      {/* Search + status filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search input — debounce owned by useAdminList (350 ms); SearchInput
            forwards keystrokes immediately so the committed-search timing is
            preserved (R6.4). */}
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder={t("Admin.Orders.searchPlaceholder")}
          debounceMs={0}
        />

        {/* Status tabs */}
        <div className="flex gap-2 flex-wrap">
          <Link
            href={buildHref(1, "", search)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${!status ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
          >
            {t("Admin.Orders.statusAll")}
          </Link>
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={buildHref(1, s, search)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${status === s ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
            >
              {STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : s.replace(/_/g, " ")}
            </Link>
          ))}
        </div>
      </div>

      <DataTable<OrderRow>
        columns={columns}
        rows={rows}
        loading={loading}
        getRowKey={(o) => String(o.id)}
        empty={
          <TableEmptyState
            colSpan={6}
            message={search
              ? t("Admin.Orders.emptySearchState").replace("{query}", search)
              : t("Admin.Orders.emptyState")}
          />
        }
      />

      <Pagination page={page} totalPages={totalPages} buildHref={(p) => buildHref(p, status, search)} />
    </div>
  );
}

export default function AdminOrdersPage() {
  const search = useSearch();
  const status = new URLSearchParams(search).get("status") ?? "";
  // Remount on status change so the status-bound fetcher refetches.
  return <OrdersListView key={status} status={status} />;
}
