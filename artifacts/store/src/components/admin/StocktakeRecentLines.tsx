import { Edit2, RotateCcw } from "lucide-react";

interface StocktakeRecentLinesProps {
  lines: any[];
  onFixTypo: (line: any) => void;
  onRecount: (line: any) => void;
}

export function StocktakeRecentLines({ lines, onFixTypo, onRecount }: StocktakeRecentLinesProps) {
  if (lines.length === 0) {
    return <div className="text-center py-8 text-xs text-muted-foreground">No items counted yet on this device.</div>;
  }

  return (
    <div className="space-y-2">
      {lines.slice(0, 15).map((l) => (
        <div key={l.id} className="p-3 bg-card border border-border rounded-xl shadow-sm flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground truncate">{l.product_title || l.sku}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{l.sku}</span>
              {l.location_note && <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{l.location_note}</span>}
            </div>
          </div>
          <div className="text-right flex items-center gap-3">
            <span className="text-base font-bold text-primary">{l.counted_quantity}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onFixTypo(l)}
                title="Fix Typo (keeps observation snapshot)"
                className="p-1.5 rounded-lg border border-input bg-background text-muted-foreground hover:text-foreground"
              >
                <Edit2 size={14} />
              </button>
              <button
                type="button"
                onClick={() => onRecount(l)}
                title="Recount Shelf (captures fresh snapshot)"
                className="p-1.5 rounded-lg border border-input bg-background text-muted-foreground hover:text-amber-500"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
