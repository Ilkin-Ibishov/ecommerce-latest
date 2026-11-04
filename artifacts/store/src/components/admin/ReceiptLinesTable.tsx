import { Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

export interface ReceiptLineItem {
  id: string;
  variant_id: string;
  quantity: number;
  unit_cost?: number | null;
  total_cost?: number | null;
  product_variant?: {
    sku: string | null;
    unit_of_measure: string;
    product?: {
      title?: string;
    };
    options_summary?: string;
  };
}

interface ReceiptLinesTableProps {
  lines: ReceiptLineItem[];
  isDraft: boolean;
  isAdmin: boolean;
  onDeleteLine: (lineId: string) => Promise<void>;
}

export function ReceiptLinesTable({ lines, isDraft, isAdmin, onDeleteLine }: ReceiptLinesTableProps) {
  const { t } = useI18n();

  if (lines.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-xl text-sm text-muted-foreground">
        {t("Admin.Receipts.noLines")}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">{t("Admin.Receipts.item")}</th>
              <th className="px-4 py-3">{t("Admin.Receipts.variant")}</th>
              <th className="px-4 py-3 text-right">{t("Admin.Receipts.quantity")}</th>
              {isAdmin && (
                <>
                  <th className="px-4 py-3 text-right">{t("Admin.Receipts.unitCost")}</th>
                  <th className="px-4 py-3 text-right">{t("Admin.Receipts.totalCost")}</th>
                </>
              )}
              {isDraft && <th className="px-4 py-3 text-right"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => {
              const pv = line.product_variant;
              const title = pv?.product?.title ?? "Product Variant";
              const sku = pv?.sku ?? line.variant_id.slice(0, 8);
              const uom = pv?.unit_of_measure ?? "pcs";

              return (
                <tr key={line.id} className="hover:bg-muted/30 transition">
                  <td className="px-4 py-3 font-medium text-foreground">{title}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs font-mono">
                    {sku} {pv?.options_summary ? `(${pv.options_summary})` : ""}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {line.quantity} <span className="text-xs text-muted-foreground font-normal">{uom}</span>
                  </td>
                  {isAdmin && (
                    <>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {line.unit_cost != null ? `${Number(line.unit_cost).toFixed(2)} ₼` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-xs">
                        {line.total_cost != null ? `${Number(line.total_cost).toFixed(2)} ₼` : "—"}
                      </td>
                    </>
                  )}
                  {isDraft && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onDeleteLine(line.id)}
                        className="p-1 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                        title="Delete line"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isAdmin && (
        <div className="p-3 bg-muted/20 border-t border-border text-center text-xs text-muted-foreground">
          {t("Admin.Receipts.costHiddenStaff")}
        </div>
      )}
    </div>
  );
}
