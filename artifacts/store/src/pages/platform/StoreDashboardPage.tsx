import { useCallback } from "react";
import { Link, useSearch } from "wouter";
import { useI18n } from "@/lib/i18n/context";
import { useAdminList } from "@/lib/hooks/useAdminList";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { platformFetch } from "@/lib/platform/fetch";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;

interface StoreRow {
  id: string;
  name: string;
  platform_status: string;
  subscription_status: string;
  plan: string | null;
  order_count: number | null;
  revenue_total: string | null;
  traffic_count: number | null;
  metrics_available: boolean;
}

const PLATFORM_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  onboarding: "bg-blue-100 text-blue-800",
  suspended: "bg-yellow-100 text-yellow-800",
  disabled: "bg-red-100 text-red-800",
};

const SUBSCRIPTION_STATUS_COLORS: Record<string, string> = {
  trialing: "bg-blue-100 text-blue-800",
  active: "bg-green-100 text-green-800",
  past_due: "bg-yellow-100 text-yellow-800",
  cancelled: "bg-red-100 text-red-800",
};

function StatusBadge({ status, colorMap }: { status: string; colorMap: Record<string, string> }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-xs font-medium",
        colorMap[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function StoreDashboardView({ subscriptionStatus }: { subscriptionStatus: string }) {
  const { t } = useI18n();

  const fetcher = useCallback(
    async (args: { offset: number; limit: number; search: string; signal: AbortSignal }) => {
      const params = new URLSearchParams();
      const page = Math.floor(args.offset / args.limit) + 1;
      params.set("page", String(page));
      params.set("pageSize", String(args.limit));
      if (subscriptionStatus) {
        params.set("subscription_status", subscriptionStatus);
      }

      const res = await platformFetch(`/platform/stores?${params.toString()}`, {
        signal: args.signal,
      });
      if (!res.ok) throw new Error(`Failed to fetch stores: ${res.status}`);
      const json = await res.json();
      return { rows: json.data as StoreRow[], count: json.total as number };
    },
    [subscriptionStatus],
  );

  const { rows, count, loading, page, totalPages } =
    useAdminList<StoreRow>({
      fetcher,
      basePath: "/platform",
      pageSize: PAGE_SIZE,
    });

  const buildHref = (p: number) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (subscriptionStatus) ps.set("subscription_status", subscriptionStatus);
    const qs = ps.toString();
    return `/platform${qs ? `?${qs}` : ""}`;
  };

  const columns: Column<StoreRow>[] = [
    {
      key: "name",
      header: t("Platform.stores.name"),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "status",
      header: t("Platform.stores.status"),
      cell: (row) => <StatusBadge status={row.platform_status} colorMap={PLATFORM_STATUS_COLORS} />,
    },
    {
      key: "subscription",
      header: t("Platform.stores.subscription"),
      cell: (row) => (
        <StatusBadge status={row.subscription_status} colorMap={SUBSCRIPTION_STATUS_COLORS} />
      ),
    },
    {
      key: "plan",
      header: t("Platform.stores.plan"),
      cell: (row) => row.plan ?? t("Platform.dashboard.metricsUnavailable"),
    },
    {
      key: "orders",
      header: t("Platform.stores.orders"),
      align: "right",
      cell: (row) =>
        row.metrics_available && row.order_count != null
          ? row.order_count
          : t("Platform.dashboard.metricsUnavailable"),
    },
    {
      key: "revenue",
      header: t("Platform.stores.revenue"),
      align: "right",
      cell: (row) =>
        row.metrics_available && row.revenue_total != null
          ? row.revenue_total
          : t("Platform.dashboard.metricsUnavailable"),
    },
    {
      key: "traffic",
      header: t("Platform.stores.traffic"),
      align: "right",
      cell: (row) =>
        row.metrics_available && row.traffic_count != null
          ? row.traffic_count
          : t("Platform.dashboard.metricsUnavailable"),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center gap-2">
          {row.platform_status === "active" && (
            <button
              onClick={() => handleSuspend(row.id)}
              className="text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
              aria-label={`${t("Platform.actions.suspend")} ${row.name}`}
            >
              {t("Platform.actions.suspend")}
            </button>
          )}
          {row.platform_status === "suspended" && (
            <button
              onClick={() => handleReactivate(row.id)}
              className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
              aria-label={`${t("Platform.actions.reactivate")} ${row.name}`}
            >
              {t("Platform.actions.reactivate")}
            </button>
          )}
          <Link
            href={`/platform/stores/${row.id}`}
            className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
          >
            {t("Platform.actions.viewDetail")}
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("Platform.dashboard.title")}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{count} total</span>
          <Link
            href="/platform/stores/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            + {t("Platform.createStore.button")}
          </Link>
        </div>
      </div>

      {/* Subscription status filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">
          {t("Platform.dashboard.filterLabel")}:
        </span>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/platform"
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              !subscriptionStatus
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted",
            )}
          >
            {t("Platform.dashboard.filterAll")}
          </Link>
          {SUBSCRIPTION_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/platform?subscription_status=${s}`}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                subscriptionStatus === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted",
              )}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      <DataTable<StoreRow>
        columns={columns}
        rows={rows}
        loading={loading}
        getRowKey={(row) => row.id}
        empty={
          <TableEmptyState
            colSpan={8}
            message={t("Platform.dashboard.empty")}
          />
        }
      />

      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
    </div>
  );
}

async function handleSuspend(storeId: string) {
  await platformFetch(`/platform/stores/${storeId}/suspend`, { method: "POST" });
  window.location.reload();
}

async function handleReactivate(storeId: string) {
  await platformFetch(`/platform/stores/${storeId}/reactivate`, { method: "POST" });
  window.location.reload();
}

export default function StoreDashboardPage() {
  const search = useSearch();
  const subscriptionStatus = new URLSearchParams(search).get("subscription_status") ?? "";
  return <StoreDashboardView key={subscriptionStatus} subscriptionStatus={subscriptionStatus} />;
}
