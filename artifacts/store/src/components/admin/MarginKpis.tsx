import { useI18n } from "@/lib/i18n/context";

export interface MarginKpiData {
  revenue: number;
  cogs: number;
  gross_margin: number;
  margin_percent: number;
  units_sold: number;
}

export function MarginKpis({ kpis }: { kpis: MarginKpiData }) {
  const { t } = useI18n();

  const isPositive = kpis.gross_margin >= 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div className="bg-card border border-border rounded-xl p-4">
        <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
          {t("Admin.Margins.revenue")}
        </span>
        <span className="text-2xl font-bold font-mono text-foreground">
          {kpis.revenue.toFixed(2)} ₼
        </span>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
          {t("Admin.Margins.cogs")}
        </span>
        <span className="text-2xl font-bold font-mono text-muted-foreground">
          {kpis.cogs.toFixed(2)} ₼
        </span>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
          {t("Admin.Margins.grossMargin")}
        </span>
        <span className={`text-2xl font-bold font-mono ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
          {kpis.gross_margin.toFixed(2)} ₼
        </span>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
          {t("Admin.Margins.marginPercent")}
        </span>
        <span className={`text-2xl font-bold font-mono ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
          {kpis.margin_percent.toFixed(1)}%
        </span>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 col-span-2 md:col-span-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
          {t("Admin.Margins.unitsSold")}
        </span>
        <span className="text-2xl font-bold font-mono text-foreground">
          {kpis.units_sold}
        </span>
      </div>
    </div>
  );
}
