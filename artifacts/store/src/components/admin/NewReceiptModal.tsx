import { useState, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { SupplierItem } from "./SupplierModal";

interface VariantOption {
  id: string;
  sku: string;
  title: string;
  price: number;
}

interface LineItemInput {
  variant_id: string;
  quantity: number;
  unit_cost: string;
}

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
  const [lines, setLines] = useState<LineItemInput[]>([]);
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      adminJson(apiUrl("/admin/suppliers"))
        .then((res) => {
          const list = Array.isArray(res) ? res : (res.suppliers ?? []);
          const active = list.filter((s: SupplierItem) => s.is_active);
          setSuppliers(active);
          if (active.length > 0 && !supplierId) setSupplierId(active[0].id);
        })
        .catch(() => {});

      const supabase = createClient();
      (async () => {
        try {
          const { data } = await supabase
            .from("product_variants")
            .select(`
              id, sku, price,
              products (
                id, title,
                product_translations (lang_code, title)
              )
            `)
            .order("sku");
          const opts: VariantOption[] = (data ?? []).map((v: any) => {
            const prod = v.products;
            const title = prod?.product_translations?.find((t: any) => t.lang_code === "az")?.title ?? prod?.title ?? v.sku ?? "Product";
            return {
              id: v.id,
              sku: v.sku ?? "",
              title,
              price: Number(v.price ?? 0),
            };
          });
          setVariantOptions(opts);
        } catch { /* ignore */ }
      })();

      setReceiptNumber(`GR-${Date.now().toString().slice(-6)}`);
      setPostingDate(new Date().toISOString().split("T")[0]);
      setNotes("");
      setShippingCost("");
      setCustomsCost("");
      setLines([]);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { variant_id: variantOptions[0]?.id ?? "", quantity: 1, unit_cost: "" },
    ]);
  };

  const updateLine = (index: number, field: keyof LineItemInput, val: any) => {
    setLines((prev) => prev.map((l, i) => i === index ? { ...l, [field]: val } : l));
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

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
      const receiptId = res?.id ?? res?.receipt?.id;
      if (!receiptId) throw new Error("Receipt creation returned invalid response");

      for (const line of lines) {
        if (line.variant_id && line.quantity > 0) {
          const costVal = line.unit_cost ? parseFloat(line.unit_cost) : undefined;
          await adminJson(apiUrl(`/admin/receipts/${receiptId}/lines`), {
            method: "POST",
            body: JSON.stringify({
              variant_id: line.variant_id,
              quantity: Number(line.quantity),
              unit_cost: costVal !== undefined && !isNaN(costVal) ? costVal : undefined,
            }),
          });
        }
      }

      onCreated(receiptId);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create receipt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30 shrink-0">
          <h3 className="font-semibold text-foreground">{t("Admin.Receipts.newReceipt")}</h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:bg-muted transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3 overflow-y-auto flex-1">
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

          {/* Receipt Line Items */}
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                Qəbz sətirləri ({lines.length})
              </span>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
              >
                <Plus size={14} /> + Sətir əlavə et
              </button>
            </div>

            {lines.length === 0 ? (
              <p className="text-xs text-muted-foreground italic bg-muted/20 p-2.5 rounded-lg border border-dashed border-border text-center">
                Heç bir məhsul əlavə edilməyib. Yuxarıdakı düymə ilə qəbzə məhsul sətirləri əlavə edin.
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {lines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border border-border/60 text-xs">
                    <select
                      value={line.variant_id}
                      onChange={(e) => updateLine(idx, "variant_id", e.target.value)}
                      required
                      className="flex-1 min-w-0 px-2 py-1 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-primary truncate"
                    >
                      <option value="">Məhsul / Variant seçin</option>
                      {variantOptions.map((vo) => (
                        <option key={vo.id} value={vo.id}>
                          {vo.title} {vo.sku ? `(${vo.sku})` : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Say"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, "quantity", Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-16 px-2 py-1 text-xs bg-background border border-border rounded text-center focus:ring-1 focus:ring-primary"
                      title="Miqdar / Say"
                    />
                    {isAdmin && (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Maya (AZN)"
                        value={line.unit_cost}
                        onChange={(e) => updateLine(idx, "unit_cost", e.target.value)}
                        className="w-20 px-2 py-1 text-xs bg-background border border-border rounded text-right focus:ring-1 focus:ring-primary"
                        title="Vahid maya dəyəri (AZN)"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition shrink-0"
                      title="Sil"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
