import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { ClipboardCheck, Plus, Sparkles, CheckCircle2, Clock, Ban } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAdminRole } from "@/lib/hooks/useAdminRole";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { NewStocktakeModal } from "@/components/admin/NewStocktakeModal";

interface StocktakeItem {
  id: string;
  stocktake_number: string;
  title: string;
  status: "draft" | "posted" | "cancelled";
  is_opening_count: boolean;
  posting_date: string;
  created_at: string;
  total_lines: number;
}

export default function StocktakesPage() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const { isAdmin } = useAdminRole();

  const [stocktakes, setStocktakes] = useState<StocktakeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "posted" | "cancelled">("all");
  const [modalOpen, setModalOpen] = useState(false);

  const fetchStocktakes = useCallback(async () => {
    try {
      setLoading(true);
      const url = statusFilter === "all"
        ? apiUrl("/admin/stocktakes")
        : apiUrl(`/admin/stocktakes?status=${statusFilter}`);
      const data = await adminJson(url);
      setStocktakes(data.stocktakes ?? []);
    } catch {
      setStocktakes([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchStocktakes();
  }, [fetchStocktakes]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardCheck size={24} className="text-primary" />
            {t("Admin.Stocktakes.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("Admin.Stocktakes.subtitle")}</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 shadow-sm"
        >
          <Plus size={18} />
          {t("Admin.Stocktakes.newCount")}
        </button>
      </div>

      <div className="flex gap-2 border-b border-border pb-3">
        {(["all", "draft", "posted", "cancelled"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${
              statusFilter === s
                ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {s === "all" ? t("Admin.Stocktakes.statusAll") : t(`Admin.Stocktakes.${s}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground">Loading stocktakes…</div>
      ) : stocktakes.length === 0 ? (
        <div className="p-12 text-center bg-card border border-border rounded-xl">
          <ClipboardCheck size={36} className="mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-foreground font-medium">{t("Admin.Stocktakes.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1">Start your first count to audit inventory</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground border-b border-border uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5">{t("Admin.Stocktakes.countNumber")}</th>
                <th className="px-5 py-3.5">Title</th>
                <th className="px-5 py-3.5">{t("Admin.Stocktakes.status")}</th>
                <th className="px-5 py-3.5">{t("Admin.Stocktakes.lines")}</th>
                <th className="px-5 py-3.5">{t("Admin.Stocktakes.date")}</th>
                <th className="px-5 py-3.5 text-right">{t("Admin.Stocktakes.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stocktakes.map((st) => (
                <tr key={st.id} className="hover:bg-muted/30 transition">
                  <td className="px-5 py-4 font-mono text-xs font-semibold text-foreground">
                    {st.stocktake_number}
                  </td>
                  <td className="px-5 py-4 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      <span>{st.title}</span>
                      {st.is_opening_count && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <Sparkles size={11} />
                          {t("Admin.Stocktakes.openingCount")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                      st.status === "posted"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : st.status === "draft"
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {st.status === "posted" ? <CheckCircle2 size={13} /> : st.status === "draft" ? <Clock size={13} /> : <Ban size={13} />}
                      {t(`Admin.Stocktakes.${st.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{st.total_lines} lines</td>
                  <td className="px-5 py-4 text-xs text-muted-foreground">
                    {new Date(st.posting_date || st.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4 text-right space-x-2">
                    {st.status === "draft" && (
                      <Link
                        href={`/admin/stocktakes/${st.id}/count`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90"
                      >
                        {t("Admin.Stocktakes.countAction")}
                      </Link>
                    )}
                    {isAdmin && (
                      <Link
                        href={`/admin/stocktakes/${st.id}/review`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-input bg-background hover:bg-muted text-foreground"
                      >
                        {st.status === "draft" ? t("Admin.Stocktakes.reviewAction") : t("Admin.Stocktakes.viewReport")}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewStocktakeModal
        open={modalOpen}
        isAdmin={isAdmin}
        onClose={() => setModalOpen(false)}
        onCreated={(id) => {
          setModalOpen(false);
          setLocation(`/admin/stocktakes/${id}/count`);
        }}
      />
    </div>
  );
}
