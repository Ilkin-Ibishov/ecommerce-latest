import { useEffect, useState, useMemo } from "react";
import { Link } from "wouter";
import { Building2, ArrowLeft, RefreshCw, AlertCircle } from "lucide-react";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n/context";
import { useAdminRole } from "@/lib/hooks/useAdminRole";
import { Badge } from "@/components/ui/badge";

interface ReorderItem {
  variant_id: string; product_id: string; product_title: string; variant_sku: string;
  barcode: string | null; unit_of_measure: string; supplier_id: string | null;
  supplier_name: string; supplier_contact: string | null; on_hand: number;
  reserved_quantity: number; available_quantity: number; units_sold_window: number;
  sales_count: number; velocity: number; days_of_cover: number | null;
  suggested_qty: number | null; has_enough_data: boolean;
}

interface SupplierGroup {
  name: string;
  contact: string | null;
  items: ReorderItem[];
}

export default function ReorderPage() {
  const { t } = useI18n();
  const { isAdmin, loading: roleLoading } = useAdminRole();
  const [items, setItems] = useState<ReorderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminJson(apiUrl("/admin/inventory/signals/reorder"));
      setItems(data.suggestions ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!roleLoading && isAdmin) loadData();
  }, [roleLoading, isAdmin]);

  const groups = useMemo(() => {
    const map = new Map<string, SupplierGroup>();
    for (const item of items) {
      const key = item.supplier_name || "Unassigned";
      const group = map.get(key) ?? { name: key, contact: item.supplier_contact || null, items: [] };
      group.items.push(item);
      map.set(key, group);
    }
    return Array.from(map.values());
  }, [items]);

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <RefreshCw className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Link href="/admin/inventory" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2 transition">
            <ArrowLeft size={14} />
            {t("Admin.Reorder.backToInventory")}
          </Link>
          <h1 className="text-2xl font-bold">{t("Admin.Reorder.title")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t("Admin.Reorder.subtitle")}</p>
        </div>
        <button type="button" onClick={loadData} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input bg-card hover:bg-muted text-xs font-semibold transition">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {t("Common.retry")}
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-4 rounded-xl flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-6 space-y-3">
              <div className="h-5 w-48 bg-muted animate-pulse rounded" />
              <div className="h-24 bg-muted/50 animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
          {t("Admin.Reorder.emptyState")}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.name} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 bg-muted/40 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <Building2 size={16} className="text-primary" />
                    {group.name === "Unassigned" ? t("Admin.Reorder.unassignedSupplier") : group.name}
                  </h2>
                  {group.contact && <p className="text-xs text-muted-foreground mt-0.5">{t("Admin.Reorder.contact")} {group.contact}</p>}
                </div>
                <span className="text-xs text-muted-foreground font-medium">
                  {t("Admin.Reorder.itemsCount").replace("{count}", String(group.items.length))}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left px-4 py-3 font-medium">{t("Admin.Reorder.colProduct")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("Admin.Reorder.colSku")}</th>
                      <th className="text-right px-4 py-3 font-medium">{t("Admin.Reorder.colAvailable")}</th>
                      <th className="text-right px-4 py-3 font-medium">{t("Admin.Reorder.colSold")}</th>
                      <th className="text-right px-4 py-3 font-medium">{t("Admin.Reorder.colSalesCount")}</th>
                      <th className="text-right px-4 py-3 font-medium">{t("Admin.Reorder.colVelocity")}</th>
                      <th className="text-right px-4 py-3 font-medium">{t("Admin.Reorder.colDaysOfCover")}</th>
                      <th className="text-right px-4 py-3 font-medium">{t("Admin.Reorder.colSuggestedQty")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((row) => (
                      <tr key={row.variant_id} className="border-b border-border/50 hover:bg-muted/20 transition">
                        <td className="px-4 py-3 font-medium">{row.product_title}</td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{row.variant_sku}</td>
                        <td className="px-4 py-3 text-right font-semibold">{row.available_quantity}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{row.units_sold_window}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{row.sales_count}</td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">{Number(row.velocity).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{row.days_of_cover !== null ? row.days_of_cover : "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {row.has_enough_data ? (
                            <span className="font-bold text-primary text-base">{row.suggested_qty ?? 0}</span>
                          ) : (
                            <span title={t("Admin.Reorder.insufficientDataTooltip")}>
                              <Badge variant="outline" className="border-amber-500/40 text-amber-500 bg-amber-500/10 text-[11px]">
                                {t("Admin.Reorder.insufficientData")}
                              </Badge>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="text-xs text-muted-foreground space-y-1 px-1">
            <p>{t("Admin.Reorder.onOrderFootnote")}</p>
            <p>{t("Admin.Reorder.formulaFootnote")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
