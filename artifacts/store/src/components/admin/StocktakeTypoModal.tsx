interface StocktakeTypoModalProps {
  open: boolean;
  editQty: string;
  onQtyChange: (val: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function StocktakeTypoModal({ open, editQty, onQtyChange, onCancel, onSave }: StocktakeTypoModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card border border-border rounded-xl p-5 max-w-xs w-full space-y-4 shadow-xl">
        <h3 className="text-sm font-bold text-foreground">Fix Mistyped Count</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Correct a typing mistake. This preserves the original snapshot time of your observation.
        </p>
        <input
          type="number"
          min="0"
          value={editQty}
          onChange={(e) => onQtyChange(e.target.value)}
          className="w-full p-2.5 rounded-lg border border-input bg-background font-bold text-center text-lg"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 text-xs font-semibold rounded-lg bg-muted text-muted-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="flex-1 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground"
          >
            Save Typo
          </button>
        </div>
      </div>
    </div>
  );
}
