import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Plus, Truck, FileText } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAdminRole } from "@/lib/hooks/useAdminRole";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { NewReceiptModal } from "@/components/admin/NewReceiptModal";

interface ReceiptListItem {
  id: string;
  receipt_number: string;
  status: "draft" | "posted" | "reversed";
  posting_date: string;
  created_at: string;
  suppliers?: { name: string } | null;
  line_count?: number;
}

export default function ReceiptsPage() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const { isAdmin } = useAdminRole();

  const [receipts, setReceipts] = useState<ReceiptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "posted" | "reversed">("all");
  const [modalOpen, setModalOpen] = useState(false);

  const fetchReceipts = useCallback(async () => {
    try {
      setLoading(true);
      const url = statusFilter === "all"
        ? apiUrl("/admin/receipts")
        : apiUrl(`/admin/receipts?status=${statusFilter}`);
      const data = await adminJson(url);
      setReceipts(data.receipts ?? []);
    } catch {
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Truck size={24} className="text-primary" />
            {t("Admin.Receipts.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("Admin.Receipts.subtitle")}</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition"
        >
          <Plus size={16} />
          {t("Admin.Receipts.newReceipt")}
        </button>
      </div>

      <div className="flex gap-1 border border-border rounded-lg p-1 bg-muted/20 w-fit">
        {(["all", "draft", "posted", "reversed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 text-xs rounded-md font-medium transition ${
              statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "all" ? t("Admin.Receipts.statusAll") : t(`Admin.Receipts.${s}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{t("Admin.Common.loading")}</div>
      ) : receipts.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl text-sm text-muted-foreground">
          {t("Admin.Receipts.empty")}
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{t("Admin.Receipts.receiptNumber")}</th>
                  <th className="px-4 py-3">{t("Admin.Receipts.supplier")}</th>
                  <th className="px-4 py-3">{t("Admin.Receipts.postingDate")}</th>
                  <th className="px-4 py-3">{t("Admin.Receipts.status")}</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {receipts.map((r) => {
                  const isDraft = r.status === "draft";
                  const isPosted = r.status === "posted";
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setLocation(`/admin/receipts/${r.id}`)}
                      className="hover:bg-muted/30 cursor-pointer transition"
                    >
                      <td className="px-4 py-3 font-mono font-medium text-foreground">
                        {r.receipt_number}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.suppliers?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {new Date(r.posting_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full ${
                          isDraft ? "bg-amber-500/10 text-amber-600" : isPosted ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
                        }`}>
                          {isDraft ? t("Admin.Receipts.draftBadge") : isPosted ? t("Admin.Receipts.postedBadge") : t("Admin.Receipts.reversedBadge")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/receipts/${r.id}`}
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <FileText size={13} /> View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewReceiptModal
        open={modalOpen}
        isAdmin={isAdmin}
        onClose={() => setModalOpen(false)}
        onCreated={(id) => setLocation(`/admin/receipts/${id}`)}
      />
    </div>
  );
}
