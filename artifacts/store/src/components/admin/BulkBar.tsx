import { X, DollarSign } from "lucide-react";

// ── Bulk action toolbar ────────────────────────────────────────────────────
export function BulkBar({ count, onFlag, onDelete, onBulkPrice, onClear }: {
  count: number;
  onFlag: (field: string, value: boolean) => void;
  onDelete: () => void;
  onBulkPrice: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  const Btn = ({ label, onClick, destructive, icon }: { label: string; onClick: () => void; destructive?: boolean; icon?: React.ReactNode }) => (
    <button onClick={onClick}
      className={`px-3 py-1 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5 ${
        destructive ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      }`}
    >
      {icon}{label}
    </button>
  );
  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-xl text-sm">
      <span className="font-medium text-primary">{count} selected</span>
      <div className="flex gap-1.5 ml-2 flex-wrap">
        <Btn label="Set Featured" onClick={() => onFlag("is_featured", true)} />
        <Btn label="Unset Featured" onClick={() => onFlag("is_featured", false)} />
        <Btn label="Set On Sale" onClick={() => onFlag("is_on_sale", true)} />
        <Btn label="Unset On Sale" onClick={() => onFlag("is_on_sale", false)} />
        <Btn label="Bulk Price" onClick={onBulkPrice} icon={<DollarSign size={12} />} />
        <Btn label="Delete" onClick={onDelete} destructive />
      </div>
      <button onClick={onClear} className="ml-auto text-muted-foreground hover:text-foreground"><X size={14} /></button>
    </div>
  );
}
