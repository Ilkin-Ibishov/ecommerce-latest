import { useI18n } from "@/lib/i18n/context";
import type { ReceiptLineItem } from "./ReceiptLinesTable";

interface ReceiptCostSummaryProps {
  lines: ReceiptLineItem[];
  additionalCosts?: Record<string, number> | null;
}

export function ReceiptCostSummary({ lines, additionalCosts }: ReceiptCostSummaryProps) {
  const { t } = useI18n();

  const itemsSubtotal = lines.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0);
  const extraCostsTotal = Object.values(additionalCosts ?? {}).reduce(
    (sum, val) => sum + (Number(val) || 0),
    0
  );
  const grandTotal = itemsSubtotal + extraCostsTotal;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3 max-w-sm ml-auto">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("Admin.Receipts.totalCost")}
      </h4>

      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>{t("Admin.Receipts.item")} ({lines.length})</span>
          <span className="font-mono text-foreground">{itemsSubtotal.toFixed(2)} ₼</span>
        </div>

        {additionalCosts && Object.keys(additionalCosts).length > 0 && (
          <div className="pt-1.5 border-t border-border space-y-1">
            <span className="text-xs text-muted-foreground font-medium">
              {t("Admin.Receipts.additionalCosts")}:
            </span>
            {Object.entries(additionalCosts).map(([key, val]) => (
              <div key={key} className="flex justify-between text-xs text-muted-foreground pl-2">
                <span className="capitalize">{key}</span>
                <span className="font-mono">{Number(val).toFixed(2)} ₼</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between font-bold text-base pt-2 border-t border-border">
          <span>{t("Admin.Receipts.totalCost")}</span>
          <span className="font-mono text-primary">{grandTotal.toFixed(2)} ₼</span>
        </div>
      </div>
    </div>
  );
}
