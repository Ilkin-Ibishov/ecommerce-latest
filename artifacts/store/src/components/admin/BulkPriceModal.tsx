import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useI18n } from "@/lib/i18n/context";

// ── Bulk Price Update Modal ────────────────────────────────────────────────
export function BulkPriceModal({ open, onClose, selectedProducts, onComplete }: {
  open: boolean;
  onClose: () => void;
  selectedProducts: { id: string; price: number }[];
  onComplete: () => void;
}) {
  const [mode, setMode] = useState<"percentage" | "fixed">("percentage");
  const [value, setValue] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  if (!open) return null;

  const { t } = useI18n();

  const handleConfirm = async () => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) return;
    setProcessing(true);
    setProgress(0);

    for (let i = 0; i < selectedProducts.length; i++) {
      const product = selectedProducts[i];
      const newPrice = mode === "percentage"
        ? product.price * (1 - numValue / 100)
        : numValue;
      await adminFetch(apiUrl(`/admin/products/${product.id}`), {
        method: "PATCH",
        body: JSON.stringify({ price: Math.max(0, Math.round(newPrice * 100) / 100) }),
      });
      setProgress(i + 1);
    }

    setProcessing(false);
    setValue("");
    onComplete();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={!processing ? onClose : undefined} />
      <div className="relative bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="font-semibold text-lg">{t("Admin.BulkPriceModal.title")}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t("Admin.BulkPriceModal.description").replace("{count}", String(selectedProducts.length))}
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="priceMode" checked={mode === "percentage"} onChange={() => setMode("percentage")} />
            {t("Admin.BulkPriceModal.percentageDiscount")}
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="priceMode" checked={mode === "fixed"} onChange={() => setMode("fixed")} />
            {t("Admin.BulkPriceModal.fixedPrice")}
          </label>

          <input
            type="number" min={0} step="0.01" value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === "percentage" ? t("Admin.BulkPriceModal.discountPercent") : t("Admin.BulkPriceModal.newPrice")}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={processing}
          />

          {processing && (
            <div className="space-y-1">
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div className="bg-primary h-full transition-all" style={{ width: `${(progress / selectedProducts.length) * 100}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{t("Admin.BulkPriceModal.progress").replace("{progress}", String(progress)).replace("{total}", String(selectedProducts.length))}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} disabled={processing}
            className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition disabled:opacity-50">
            {t("Admin.Common.cancel")}
          </button>
          <button onClick={handleConfirm} disabled={processing || !value}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {processing ? t("Admin.BulkPriceModal.updating") : t("Admin.BulkPriceModal.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
