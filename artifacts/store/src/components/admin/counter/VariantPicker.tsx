import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { optionLabel, type LookupItem } from "./types";

// Several matches: the shared colour barcode is the ordinary case (M3 spec §7). Option values
// first, nothing pre-selected, nothing remembered; variants with nothing available are shown.
export function VariantPicker({ items, onPick, onClose }: {
  items: LookupItem[];
  onPick: (item: LookupItem) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Hansı variant?</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.variant_id}>
              <button
                type="button"
                onClick={() => onPick(item)}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {item.image
                  ? <img src={item.image} alt="" className="h-12 w-12 rounded object-cover" />
                  : <div className="h-12 w-12 rounded bg-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold">{optionLabel(item.options) || item.sku}</p>
                  <p className="truncate text-sm text-muted-foreground">{item.title}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{item.price.toFixed(2)} AZN</p>
                  <p className={`text-xs ${item.available > 0 ? "text-muted-foreground" : "text-destructive"}`}>
                    {item.available} mövcud
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
