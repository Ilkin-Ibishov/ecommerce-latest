import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import type { SupplierItem } from "./SupplierModal";

interface NewReceiptModalProps {
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onCreated: (receiptId: string) => void;
}

export function NewReceiptModal({ open, isAdmin, onClose, onCreated }: NewReceiptModalProps) {
  const { t } = useI18n();
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [customsCost, setCustomsCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      adminJson(apiUrl("/admin/suppliers")).then((res) => {
        const active = (res.suppliers ?? []).filter((s: SupplierItem) => s.is_active);
        setSuppliers(active);
        if (active.length > 0 && !supplierId) setSupplierId(active[0].id);
      }).catch(() => {});
      setReceiptNumber(`GR-${Date.now().toString().slice(-6)}`);
      setPostingDate(new Date().toISOString().split("T")[0]);
      setNotes(""); setShippingCost(""); setCustomsCost(""); setError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) { setError("Please select a supplier"); return; }
    setSaving(true); setError(null);

    const payload: any = {
      supplier_id: supplierId,
      receipt_number: receiptNumber.trim() || undefined,
      posting_date: postingDate ? `${postingDate}T12:00:00Z` : undefined,
      notes: notes.trim() || undefined,
    };

    if (isAdmin) {
      const ship = parseFloat(shippingCost);
      const cust = parseFloat(customsCost);
      if ((!isNaN(ship) && ship > 0) || (!isNaN(cust) && cust > 0)) {
        payload.additional_costs = {
          shipping: !isNaN(ship) && ship > 0 ? ship : undefined,
          customs: !isNaN(cust) && cust > 0 ? cust : undefined,
        };
      }
    }

    try {
      const res = await adminJson(apiUrl("/admin/receipts"), {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onCreated(res.receipt.id);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create receipt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <h3 className="font-semibold text-foreground">{t("Admin.Receipts.newReceipt")}</h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:bg-muted transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {error && <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">{error}</div>}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Receipts.supplier")} *</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">{t("Admin.Receipts.selectSupplier")}</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Receipts.receiptNumber")}</label>
              <input type="text" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Receipts.postingDate")}</label>
              <input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>

          {isAdmin && (
            <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-2">
              <span className="text-xs font-medium text-foreground">{t("Admin.Receipts.additionalCosts")} (AZN)</span>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step="0.01" min="0" placeholder="Shipping / Çatdırılma" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-primary" />
                <input type="number" step="0.01" min="0" placeholder="Customs / Gömrük" value={customsCost} onChange={(e) => setCustomsCost(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-primary" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Receipts.notes")}</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted">
              {t("Admin.Common.cancel")}
            </button>
            <button type="submit" disabled={saving} className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-medium">
              {saving ? t("Admin.Common.saving") : t("Admin.Common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
