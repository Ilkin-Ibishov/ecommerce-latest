import { useState, useRef } from "react";
import { Barcode, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { BarcodeVariantPicker } from "@/components/admin/BarcodeVariantPicker";
import type { BarcodeScanMatch } from "@workspace/api-client-react";

interface ReceiptScannerBarProps {
  isAdmin: boolean;
  disabled?: boolean;
  onAddLine: (variantId: string, quantity: number, unitCost?: number) => Promise<void>;
}

export function ReceiptScannerBar({ isAdmin, disabled, onAddLine }: ReceiptScannerBarProps) {
  const { t } = useI18n();
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<BarcodeScanMatch[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await adminJson(apiUrl(`/inventory/scan/${encodeURIComponent(cleanBarcode)}`));
      const matches: BarcodeScanMatch[] = data.matches ?? [];
      if (matches.length === 0) {
        setErrorMsg(`Barcode "${cleanBarcode}" not found`);
      } else if (matches.length === 1) {
        await addMatchedVariant(matches[0]);
      } else {
        setCandidates(matches);
      }
    } catch {
      setErrorMsg(`Barcode "${cleanBarcode}" not found in inventory`);
    } finally {
      setLoading(false);
    }
  };

  const addMatchedVariant = async (match: BarcodeScanMatch) => {
    const qty = Math.max(1, parseFloat(quantity) || 1);
    const packMultiplier = match.variant.pack_quantity || 1;
    const totalQty = qty * packMultiplier;
    const cost = isAdmin && unitCost ? parseFloat(unitCost) : undefined;

    await onAddLine(match.variant.id, totalQty, cost);
    setBarcode("");
    setCandidates(null);
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <form onSubmit={handleScanSubmit} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            disabled={disabled || loading}
            value={barcode}
            onChange={(e) => { setBarcode(e.target.value); setErrorMsg(null); }}
            placeholder={t("Admin.Receipts.scanBarcode")}
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
        </div>

        <div className="w-24">
          <input
            type="number"
            min="1"
            step="1"
            disabled={disabled || loading}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            title={t("Admin.Receipts.quantity")}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-center focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {isAdmin && (
          <div className="w-28">
            <input
              type="number"
              step="0.01"
              min="0"
              disabled={disabled || loading}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder={t("Admin.Receipts.unitCost")}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={disabled || loading || !barcode.trim()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition inline-flex items-center gap-1.5 shrink-0"
        >
          <Plus size={16} />
          {t("Admin.Receipts.addLine")}
        </button>
      </form>

      {errorMsg && (
        <p className="text-xs text-destructive">{errorMsg}</p>
      )}

      {candidates && candidates.length > 0 && (
        <BarcodeVariantPicker
          barcode={barcode}
          matches={candidates}
          onSelect={addMatchedVariant}
          onCancel={() => setCandidates(null)}
        />
      )}
    </div>
  );
}
