import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useI18n } from "@/lib/i18n/context";
import { apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

interface StoreDetail {
  id: string;
  name: string;
  platform_status: string;
  subscription_status: string;
  plan: string | null;
  owner_email: string | null;
  instance_url: string | null;
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

export default function StoreDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const storeId = params.id;

  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(apiUrl(`/platform/stores/${storeId}`), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch store: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        setStore(json.data as StoreDetail);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => controller.abort();
  }, [storeId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link
            href="/platform"
            className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
          >
            ← {t("Platform.detail.backToList")}
          </Link>
        </div>
        <div className="flex items-center justify-center py-12">
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link
            href="/platform"
            className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
          >
            ← {t("Platform.detail.backToList")}
          </Link>
        </div>
        <div className="flex items-center justify-center py-12">
          <span className="text-destructive text-sm">{error ?? "Store not found"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div className="flex items-center gap-4">
        <Link
          href="/platform"
          className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          ← {t("Platform.detail.backToList")}
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{store.name}</h1>
          <StatusBadge status={store.platform_status} colorMap={PLATFORM_STATUS_COLORS} />
        </div>
        <div className="flex items-center gap-2">
          {store.platform_status === "active" && (
            <button
              onClick={() => handleSuspend(store.id)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={`${t("Platform.actions.suspend")} ${store.name}`}
            >
              {t("Platform.actions.suspend")}
            </button>
          )}
          {store.platform_status === "suspended" && (
            <button
              onClick={() => handleReactivate(store.id)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={`${t("Platform.actions.reactivate")} ${store.name}`}
            >
              {t("Platform.actions.reactivate")}
            </button>
          )}
          {store.platform_status === "onboarding" && (
            <button
              onClick={() => handleActivate(store.id)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 text-green-800 hover:bg-green-200 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={`${t("Platform.actions.activate")} ${store.name}`}
            >
              {t("Platform.actions.activate")}
            </button>
          )}
        </div>
      </div>

      {/* Store info card */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">{t("Platform.detail.title")}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">{t("Platform.stores.name")}:</span>
            <span className="ml-2 font-medium">{store.name}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("Platform.detail.ownerEmail")}:</span>
            <span className="ml-2 font-medium">{store.owner_email ?? t("Platform.dashboard.metricsUnavailable")}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("Platform.stores.status")}:</span>
            <span className="ml-2">
              <StatusBadge status={store.platform_status} colorMap={PLATFORM_STATUS_COLORS} />
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("Platform.stores.subscription")}:</span>
            <span className="ml-2">
              <StatusBadge status={store.subscription_status} colorMap={SUBSCRIPTION_STATUS_COLORS} />
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("Platform.stores.plan")}:</span>
            <span className="ml-2 font-medium">{store.plan ?? t("Platform.dashboard.metricsUnavailable")}</span>
          </div>
        </div>
      </div>

      {/* Metrics card */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">{t("Platform.detail.metrics")}</h2>

        {store.metrics_available ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <MetricCard
              label={t("Platform.stores.orders")}
              value={store.order_count != null ? String(store.order_count) : t("Platform.dashboard.metricsUnavailable")}
            />
            <MetricCard
              label={t("Platform.stores.revenue")}
              value={store.revenue_total ?? t("Platform.dashboard.metricsUnavailable")}
            />
            <MetricCard
              label={t("Platform.stores.traffic")}
              value={store.traffic_count != null ? String(store.traffic_count) : t("Platform.dashboard.metricsUnavailable")}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("Platform.dashboard.metricsUnavailable")}
          </p>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

async function handleSuspend(storeId: string) {
  await fetch(apiUrl(`/platform/stores/${storeId}/suspend`), { method: "POST" });
  window.location.reload();
}

async function handleReactivate(storeId: string) {
  await fetch(apiUrl(`/platform/stores/${storeId}/reactivate`), { method: "POST" });
  window.location.reload();
}

async function handleActivate(storeId: string) {
  await fetch(apiUrl(`/platform/stores/${storeId}/activate`), { method: "POST" });
  window.location.reload();
}
