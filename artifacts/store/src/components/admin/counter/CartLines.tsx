import { useState, useEffect } from "react";
import { Minus, Plus, Trash2, AlertTriangle } from "lucide-react";
import type { CartLine } from "./types";

function QuantityCell({
  quantity,
  disabled,
  onChange,
}: {
  quantity: number;
  disabled: boolean;
  onChange: (q: number) => void;
}) {
  const [val, setVal] = useState<string>(String(quantity));

  useEffect(() => {
    setVal(String(quantity));
  }, [quantity]);

  const commit = () => {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      setVal(String(parsed));
      onChange(parsed);
    } else {
      setVal(String(quantity));
      onChange(quantity);
    }
  };

  return (
    <input
      type="number"
      min="1"
      disabled={disabled}
      value={val}
      aria-label="Miqdar"
      onChange={(e) => {
        setVal(e.target.value);
        const parsed = parseInt(e.target.value, 10);
        if (!isNaN(parsed) && parsed >= 1) {
          onChange(parsed);
        }
      }}
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
  if (lines.length === 0) {
    return <p className="py-10 text-center text-muted-foreground">Səbət boşdur</p>;
  }
  const qtyByVariant = new Map<string, number>();
  lines.forEach((l) => qtyByVariant.set(l.variant_id, (qtyByVariant.get(l.variant_id) ?? 0) + l.quantity));

  return (
    <ul className="divide-y divide-border">
      {lines.map((line, i) => {
        const total = qtyByVariant.get(line.variant_id) ?? line.quantity;
        const overOnHand = total > line.on_hand;
        const overAvailable = !overOnHand && total > line.available && line.reservations.length > 0;
        return (
          <li key={line.key} className="py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{line.title}</p>
                <p className="text-sm text-muted-foreground">
                  {line.options}{line.options && " · "}{line.unit_price.toFixed(2)} AZN
                  {line.bundle_id && <span className="ml-2 rounded bg-muted px-1.5 text-xs">dəst</span>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Azalt" disabled={locked || line.quantity <= 1}
                  onClick={() => onQuantity(line.key, line.quantity - 1)}
                  className="rounded-md border border-border p-2 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <QuantityCell
                  quantity={line.quantity}
                  disabled={locked}
                  onChange={(q) => onQuantity(line.key, q)}
                />
                <button type="button" aria-label="Artır" disabled={locked}
                  onClick={() => onQuantity(line.key, line.quantity + 1)}
                  className="rounded-md border border-border p-2 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
              </div>
              <p className="w-24 text-right font-semibold tabular-nums">{(nets[i] ?? 0).toFixed(2)}</p>
              <button type="button" aria-label="Sil" disabled={locked} onClick={() => onRemove(line.key)}
                className="rounded-md p-2 text-muted-foreground hover:text-destructive disabled:opacity-40">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {overOnHand && (
              <p className="mt-1 flex items-center gap-1 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Sistemdə {line.on_hand} ədəd var. Satış qeyd olunacaq, sahibkar stoku yoxlamalıdır.
              </p>
            )}
            {overAvailable && (
              <p className="mt-1 flex items-center gap-1 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Rezervdədir: {line.reservations.map((r) => `${r.customer_name} (${r.quantity}, ${r.reservation_number})`).join(", ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
