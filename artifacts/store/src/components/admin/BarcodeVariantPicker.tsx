import type { BarcodeScanMatch } from "@workspace/api-client-react";
import { Check, X } from "lucide-react";

export interface BarcodeVariantPickerProps {
  barcode: string;
  matches: BarcodeScanMatch[];
  onSelect: (selected: BarcodeScanMatch) => void;
  onCancel?: () => void;
}

/**
 * Deliberately plain variant picker for multi-match barcode scans (Scenario S2).
 * Displays candidate variants without ranking or learned preferences so the operator
 * can manually disambiguate shared manufacturer barcodes.
 */
export function BarcodeVariantPicker({
  barcode,
  matches,
  onSelect,
  onCancel,
}: BarcodeVariantPickerProps) {
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/40">
          <div>
            <h3 className="font-semibold text-base text-foreground">Select Matching Variant</h3>
            <p className="text-xs text-muted-foreground">
              Barcode <span className="font-mono font-medium text-foreground">{barcode}</span> matches {matches.length} variants
            </p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-1 rounded text-muted-foreground hover:bg-muted transition"
              title="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Candidate list */}
        <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {matches.map((item) => {
            const variant = item.variant;
            const product = item.product;
            const optionsStr = variant.options?.map((o) => `${o.name}: ${o.value}`).join(", ") || "Default";

            return (
              <div
                key={variant.id}
                onClick={() => onSelect(item)}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-background hover:bg-muted/50 cursor-pointer transition"
              >
                <div className="flex items-center gap-3">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.title}
                      className="w-10 h-10 object-cover rounded border border-border"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground font-mono">
                      N/A
                    </div>
                  )}
                  <div>
                    <div className="font-medium text-sm text-foreground">{product.title}</div>
                    <div className="text-xs text-primary font-medium">{optionsStr}</div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      SKU: {variant.sku || "—"} • Stock: {variant.on_hand} {variant.unit_of_measure}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold text-sm">
                    {variant.price.toFixed(2)} ₼
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(item);
                    }}
                    className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition flex items-center gap-1"
                  >
                    <Check size={12} /> Select
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
