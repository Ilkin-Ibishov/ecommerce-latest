/**
 * Platform Analytics Page — MRR, status counts, new/churned, revenue-by-plan.
 *
 * Feature: super-admin-platform
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.11
 *
 * Fetches from GET /api/platform/analytics?from=&to=
 * All strings via useI18n() t(key) for az/ru/en.
 * Period selector with from/to date inputs, default last 30 days.
 */
import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { apiUrl } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevenueByPlan {
  plan_id: string;
  plan_name: string;
  revenue: string;
}

interface AnalyticsData {
  mrr: string;
  active_count: number;
  past_due_count: number;
  cancelled_count: number;
  new_stores: number;
  churned_stores: number;
  revenue_by_plan: RevenueByPlan[];
  period: { from: string; to: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Metric Card
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  large,
}: {
  label: string;
  value: string | number;
  large?: boolean;
}) {
  return (
    <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className={large ? "text-3xl font-bold" : "text-xl font-semibold"}>
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const { t } = useI18n();

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(
    async (fromDate: string, toDate: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);

        const res = await fetch(
          apiUrl(`/platform/analytics?${params.toString()}`),
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        const json = await res.json();
        setData(json.data as AnalyticsData);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Fetch on initial mount with default range
  useEffect(() => {
    fetchAnalytics(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = () => {
    fetchAnalytics(from, to);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-bold">{t("Platform.analytics.title")}</h1>

      {/* Period selector */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <label htmlFor="analytics-from" className="text-sm text-muted-foreground">
            {t("Platform.analytics.periodFrom")}
          </label>
          <input
            id="analytics-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="analytics-to" className="text-sm text-muted-foreground">
            {t("Platform.analytics.periodTo")}
          </label>
          <input
            id="analytics-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <button
          onClick={handleApply}
          disabled={loading}
          className="px-4 py-1.5 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {t("Platform.analytics.apply")}
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-muted-foreground text-sm">Loading...</div>
      )}

      {/* Error state */}
      {error && (
        <div className="text-destructive text-sm">{error}</div>
      )}

      {/* Data display */}
      {data && !loading && (
        <>
          {/* MRR - large card */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard
              label={t("Platform.analytics.mrr")}
              value={`$${data.mrr}`}
              large
            />
            <MetricCard
              label={t("Platform.analytics.activeStores")}
              value={data.active_count}
            />
            <MetricCard
              label={t("Platform.analytics.pastDueStores")}
              value={data.past_due_count}
            />
            <MetricCard
              label={t("Platform.analytics.cancelledStores")}
              value={data.cancelled_count}
            />
            <MetricCard
              label={t("Platform.analytics.newStores")}
              value={data.new_stores}
            />
            <MetricCard
              label={t("Platform.analytics.churnedStores")}
              value={data.churned_stores}
            />
          </div>

          {/* Revenue by plan table */}
          {data.revenue_by_plan.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">
                {t("Platform.analytics.revenueByPlan")}
              </h2>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                        {t("Platform.analytics.planName")}
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                        {t("Platform.analytics.planRevenue")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.revenue_by_plan.map((row) => (
                      <tr key={row.plan_id} className="border-t border-border">
                        <td className="px-4 py-2">{row.plan_name}</td>
                        <td className="px-4 py-2 text-right font-medium">
                          ${row.revenue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* No revenue data */}
          {data.revenue_by_plan.length === 0 && (
            <p className="text-muted-foreground text-sm mt-4">
              {t("Platform.analytics.noData")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
