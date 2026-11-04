import { useI18n } from "@/lib/i18n/context";

export interface MarginContributor {
  variant_id: string;
  sku: string | null;
  title: string;
  category: string | null;
  units_sold: number;
  revenue: number;
  cogs: number;
  margin: number;
  margin_percent: number;
}

interface MarginContributorsTableProps {
  title: string;
  contributors: MarginContributor[];
  isTop?: boolean;
}

export function MarginContributorsTable({ title, contributors, isTop }: MarginContributorsTableProps) {
  const { t } = useI18n();

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">{contributors.length} items</span>
      </div>

      {contributors.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">{t("Admin.Margins.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 border-b border-border text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t("Admin.Margins.product")}</th>
                <th className="px-3 py-2">{t("Admin.Margins.sku")}</th>
                <th className="px-3 py-2">{t("Admin.Margins.category")}</th>
                <th className="px-3 py-2 text-right">{t("Admin.Margins.unitsSold")}</th>
                <th className="px-3 py-2 text-right">{t("Admin.Margins.revenue")}</th>
                <th className="px-3 py-2 text-right">{t("Admin.Margins.cogs")}</th>
                <th className="px-3 py-2 text-right">{t("Admin.Margins.margin")}</th>
                <th className="px-3 py-2 text-right">{t("Admin.Margins.marginPercent")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {contributors.map((c) => {
                const pos = c.margin >= 0;
                return (
                  <tr key={c.variant_id} className="hover:bg-muted/20 transition">
                    <td className="px-3 py-2 font-sans font-medium text-foreground max-w-[180px] truncate">
                      {c.title}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{c.sku ?? "—"}</td>
                    <td className="px-3 py-2 font-sans text-muted-foreground">{c.category ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-foreground">{c.units_sold}</td>
                    <td className="px-3 py-2 text-right text-foreground">{c.revenue.toFixed(2)} ₼</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{c.cogs.toFixed(2)} ₼</td>
                    <td className={`px-3 py-2 text-right font-semibold ${
                      pos ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                    }`}>
                      {c.margin.toFixed(2)} ₼
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${
                      pos ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                    }`}>
                      {c.margin_percent.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
