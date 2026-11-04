import { useState, useEffect, useCallback } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, CheckCircle2, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAdminRole } from "@/lib/hooks/useAdminRole";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { ReceiptScannerBar } from "@/components/admin/ReceiptScannerBar";
import { ReceiptLinesTable, type ReceiptLineItem } from "@/components/admin/ReceiptLinesTable";
import { ReceiptCostSummary } from "@/components/admin/ReceiptCostSummary";

export default function ReceiptDetailPage({ id: propId }: { id?: string }) {
  const [, params] = useRoute("/admin/receipts/:id");
  const receiptId = propId || params?.id;
  const { t } = useI18n();
  const { isAdmin } = useAdminRole();

  const [receipt, setReceipt] = useState<any>(null);
  const [lines, setLines] = useState<ReceiptLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchReceipt = useCallback(async () => {
    if (!receiptId) return;
    try {
      setLoading(true);
      const data = await adminJson(apiUrl(`/admin/receipts/${receiptId}`));
      setReceipt(data.receipt);
      setLines(data.receipt?.lines ?? []);
    } catch {
      setReceipt(null);
    } finally {
      setLoading(false);
    }
  }, [receiptId]);

  useEffect(() => {
    fetchReceipt();
  }, [fetchReceipt]);

  const handleAddLine = async (variantId: string, quantity: number, unitCost?: number) => {
    if (!receiptId) return;
    try {
      await adminJson(apiUrl(`/admin/receipts/${receiptId}/lines`), {
        method: "POST",
        body: JSON.stringify({ variant_id: variantId, quantity, unit_cost: unitCost }),
      });
      fetchReceipt();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!receiptId) return;
    try {
      await adminJson(apiUrl(`/admin/receipts/${receiptId}/lines/${lineId}`), {
        method: "DELETE",
      });
      fetchReceipt();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handlePost = async () => {
    if (!window.confirm(t("Admin.Receipts.confirmPost"))) return;
    setActionLoading(true);
    try {
      await adminJson(apiUrl(`/admin/receipts/${receiptId}/post`), { method: "POST" });
      fetchReceipt();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReverse = async () => {
    const reason = window.prompt(t("Admin.Receipts.reversalReason"));
    if (!reason || !reason.trim()) return;
    setActionLoading(true);
    try {
      await adminJson(apiUrl(`/admin/receipts/${receiptId}/reverse`), {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      fetchReceipt();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">{t("Admin.Common.loading")}</div>;
  }
  if (!receipt) {
    return <div className="text-center py-12 text-sm text-muted-foreground">{t("Admin.Receipts.empty")}</div>;
  }

  const isDraft = receipt.status === "draft";
  const isPosted = receipt.status === "posted";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <Link href="/admin/receipts" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> {t("Admin.Receipts.backToList")}
        </Link>
        <div className="flex items-center gap-2">
          {isDraft && (
            <button
              onClick={handlePost}
              disabled={actionLoading || lines.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              <CheckCircle2 size={16} /> {t("Admin.Receipts.post")}
            </button>
          )}
          {isPosted && (
            <button
              onClick={handleReverse}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-destructive/40 text-destructive rounded-lg text-xs font-medium hover:bg-destructive/10 transition"
            >
              <RotateCcw size={14} /> {t("Admin.Receipts.reverse")}
            </button>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <span className="font-mono text-xs text-muted-foreground">{t("Admin.Receipts.receiptNumber")}</span>
            <h1 className="text-xl font-bold text-foreground font-mono">{receipt.receipt_number}</h1>
          </div>
          <span className={`px-2.5 py-1 text-xs font-semibold rounded-full self-start sm:self-auto ${
            isDraft ? "bg-amber-500/10 text-amber-600" : isPosted ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
          }`}>
            {isDraft ? t("Admin.Receipts.draftBadge") : isPosted ? t("Admin.Receipts.postedBadge") : t("Admin.Receipts.reversedBadge")}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">{t("Admin.Receipts.supplier")}</span>
            <span className="font-medium text-foreground">{receipt.suppliers?.name ?? "—"}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">{t("Admin.Receipts.postingDate")}</span>
            <span className="font-mono text-xs text-foreground">{new Date(receipt.posting_date).toLocaleDateString()}</span>
          </div>
          {receipt.notes && (
            <div className="col-span-2 sm:col-span-1">
              <span className="text-xs text-muted-foreground block">{t("Admin.Receipts.notes")}</span>
              <span className="text-xs text-muted-foreground">{receipt.notes}</span>
            </div>
          )}
        </div>
      </div>

      {isDraft && (
        <div className="bg-muted/10 border border-border rounded-xl p-4">
          <ReceiptScannerBar isAdmin={isAdmin} onAddLine={handleAddLine} />
        </div>
      )}

      <ReceiptLinesTable
        lines={lines}
        isDraft={isDraft}
        isAdmin={isAdmin}
        onDeleteLine={handleDeleteLine}
      />

      {isAdmin && lines.length > 0 && (
        <ReceiptCostSummary
          lines={lines}
          additionalCosts={receipt.additional_costs}
        />
      )}
    </div>
  );
}
