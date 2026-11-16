import { useState, useEffect } from "react";
import { Minus, Plus, Trash2, AlertTriangle } from "lucide-react";
import type { CartLine } from "./types";
import { parseQuantity } from "./counter-input";
import { useI18n } from "@/lib/i18n/context";

function QuantityCell({
  quantity,
  disabled,
  onChange,
}: {
  quantity: number;
  disabled: boolean;
  onChange: (q: number) => void;
}) {
  const { t } = useI18n();
  const [val, setVal] = useState<string>(String(quantity));

  useEffect(() => {
    setVal(String(quantity));
  }, [quantity]);

  const commit = () => {
    const q = parseQuantity(val);
    if (q !== null) {
      setVal(String(q));
      if (q !== quantity) {
        onChange(q);
      }
    } else {
      setVal(String(quantity));
    }
  };

  return (
    <input
      type="number"
      min="1"
      disabled={disabled}
      value={val}
      aria-label={t("Admin.Counter.quantity")}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
      }}
      className="w-14 rounded-md border border-border bg-background px-1 py-1 text-center font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-primary"
    />
  );
}

// The cart with the two warnings the cashier needs before payment (M3 spec §7, §8):
// more than the system's on-hand (the sale will need the owner), and selling reserved stock.
export function CartLines({ lines, nets, locked, onQuantity, onRemove }: {
  lines: CartLine[];
  nets: number[];
  locked: boolean;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useI18n();
  if (lines.length === 0) {
    return <p className="py-10 text-center text-muted-foreground">{t("Admin.Counter.cartEmpty")}</p>;
  }
  const qtyByVariant = new Map<string, number>();
  lines.forEach((l) => qtyByVariant.set(l.variant_id, (qtyByVariant.get(l.variant_id) ?? 0) + l.quantity));

  return (
    <ul className="divide-y divide-border">
      {lines.map((line, i) => {
        const total = qtyByVariant.get(line.variant_id) ?? line.quantity;
        const overOnHand = line.available !== null && total > line.on_hand;
        const overAvailable = !overOnHand && line.available !== null && total > line.available && line.reservations.length > 0;
        return (
          <li key={line.key} className="py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{line.title}</p>
                <p className="text-sm text-muted-foreground">
                  {line.options}{line.options && " · "}{line.unit_price.toFixed(2)} AZN
                  {line.bundle_id && <span className="ml-2 rounded bg-muted px-1.5 text-xs">{t("Admin.Counter.bundleBadge")}</span>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={t("Admin.Counter.decrease")} disabled={locked || line.quantity <= 1}
                  onClick={() => onQuantity(line.key, line.quantity - 1)}
                  className="rounded-md border border-border p-2 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <QuantityCell
                  quantity={line.quantity}
                  disabled={locked}
                  onChange={(q) => onQuantity(line.key, q)}
                />
                <button type="button" aria-label={t("Admin.Counter.increase")} disabled={locked || line.quantity >= 9999}
                  onClick={() => onQuantity(line.key, line.quantity + 1)}
                  className="rounded-md border border-border p-2 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
              </div>
              <p className="w-24 text-right font-semibold tabular-nums">{(nets[i] ?? 0).toFixed(2)}</p>
              <button type="button" aria-label={t("Admin.Counter.remove")} disabled={locked} onClick={() => onRemove(line.key)}
                className="rounded-md p-2 text-muted-foreground hover:text-destructive disabled:opacity-40">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {overOnHand && (
              <p className="mt-1 flex items-center gap-1 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                {t("Admin.Counter.stockWarningOnHand").replace("{n}", String(line.on_hand))}
              </p>
            )}
            {overAvailable && (
              <p className="mt-1 flex items-center gap-1 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                {t("Admin.Counter.stockWarningReserved").replace("{reservations}", line.reservations.map((r) => `${r.customer_name} (${r.quantity}, ${r.reservation_number})`).join(", "))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
