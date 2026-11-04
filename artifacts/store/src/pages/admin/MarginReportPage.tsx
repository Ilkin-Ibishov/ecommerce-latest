import { useState, useEffect, useCallback } from "react";
import { TrendingUp, ShieldAlert, Calendar, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAdminRole } from "@/lib/hooks/useAdminRole";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { MarginKpis, type MarginKpiData } from "@/components/admin/MarginKpis";
import { MarginContributorsTable, type MarginContributor } from "@/components/admin/MarginContributorsTable";

export default function MarginReportPage() {
  const { t } = useI18n();
  const { isAdmin, loading: roleLoading } = useAdminRole();

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<MarginKpiData | null>(null);
  const [topContributors, setTopContributors] = useState<MarginContributor[]>([]);
  const [bottomContributors, setBottomContributors] = useState<MarginContributor[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("categories").select("id, slug").then(({ data }) => {
      setCategories((data ?? []).map((c) => ({ id: c.id, name: c.slug })));
    });
  }, []);

  const fetchReport = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setLoading(true);
      const params = new URLSearchParams({
        from: `${from}T00:00:00Z`,
        to: `${to}T23:59:59Z`,
      });
      if (categoryId) params.set("category_id", categoryId);
      const data = await adminJson(apiUrl(`/admin/margins?${params.toString()}`));
      setKpis(data.kpis ?? null);
      setTopContributors(data.top_contributors ?? []);
      setBottomContributors(data.bottom_contributors ?? []);
    } catch {
      setKpis(null);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, from, to, categoryId]);

  useEffect(() => {
    if (isAdmin) fetchReport();
  }, [isAdmin, fetchReport]);

  if (roleLoading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">{t("Admin.Common.loading")}</div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-card border border-border rounded-xl text-center space-y-3">
        <ShieldAlert size={36} className="text-destructive mx-auto" />
        <h2 className="text-lg font-bold text-foreground">{t("Admin.Layout.adminAccessRequired")}</h2>
        <p className="text-xs text-muted-foreground">{t("Admin.Margins.ownerOnlyNotice")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp size={24} className="text-primary" />
          {t("Admin.Margins.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("Admin.Margins.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-muted-foreground" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">—</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">{t("Admin.Margins.allCategories")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <button
          onClick={fetchReport}
          className="px-4 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition ml-auto"
        >
          {t("Admin.Margins.apply")}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{t("Admin.Common.loading")}</div>
      ) : kpis ? (
        <div className="space-y-6">
          {Number(kpis.unpriced_units_out ?? 0) > 0 && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 rounded-xl text-sm flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <span className="font-semibold block">
                  {kpis.unpriced_units_out} {t("Admin.Margins.unpricedUnitsNote")}
                </span>
                <span className="text-xs text-muted-foreground block">
                  {t("Admin.Margins.unpricedUnitsExplanation")}
                </span>
              </div>
            </div>
          )}
          <MarginKpis kpis={kpis} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MarginContributorsTable
              title={t("Admin.Margins.topContributors")}
              contributors={topContributors}
              isTop
            />
            <MarginContributorsTable
              title={t("Admin.Margins.bottomContributors")}
              contributors={bottomContributors}
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-xl text-sm text-muted-foreground">
          {t("Admin.Margins.empty")}
        </div>
      )}
    </div>
  );
}
