import { AlertTriangle, Check, Layers, User } from "lucide-react";

interface StocktakeResolutionCardProps {
  item: any;
  onResolve: (variantId: string, resolutionType: "sum" | "override", chosenLineId?: string, resolvedQty?: number) => Promise<void>;
}

export function StocktakeResolutionCard({ item, onResolve }: StocktakeResolutionCardProps) {
  const isSuspicious = item.resolution_status === "unresolved_conflict";

  return (
    <div className={`p-4 rounded-xl border transition ${
      isSuspicious
        ? "bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-200"
        : "bg-card border-border text-foreground"
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {isSuspicious && <AlertTriangle size={18} className="text-amber-500 shrink-0" />}
            <span className="font-bold text-sm text-foreground">{item.product_title}</span>
            <span className="text-xs font-mono text-muted-foreground">{item.sku}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.scan_count} counters scanned this variant:{" "}
            {item.contributing_lines.map((l: any, i: number) => (
              <span key={l.id} className="font-medium">
                {i > 0 ? " + " : ""}
                {l.counter_name || "Staff"} ({l.counted_quantity} at {l.location_note || "unspecified"})
              </span>
            ))}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const sum = item.contributing_lines.reduce((acc: number, l: any) => acc + l.counted_quantity, 0);
              onResolve(item.variant_id, "sum", undefined, sum);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
              item.resolution_status === "sum_resolved" || item.resolution_status === "sum_defaulted"
                ? "bg-primary text-primary-foreground"
                : "border border-input bg-background hover:bg-muted"
            }`}
          >
            <Layers size={13} />
            Sum Locations ({item.contributing_lines.reduce((a: number, b: any) => a + b.counted_quantity, 0)})
          </button>

          {item.contributing_lines.map((l: any) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onResolve(item.variant_id, "override", l.id, l.counted_quantity)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-input bg-background hover:bg-muted flex items-center gap-1"
            >
              <User size={12} />
              Use {l.counter_name || "Scan"} ({l.counted_quantity})
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
