import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { Check, X } from "lucide-react";

const REASONS = [
  { value: "manual_adjustment", label: "Manual Adjustment" },
  { value: "stocktake_correction", label: "Stocktake Correction" },
  { value: "damage_write_off", label: "Damage / Write-off" },
  { value: "goods_receipt", label: "Goods Receipt" },
  { value: "customer_return", label: "Customer Return" },
  { value: "return_to_supplier", label: "Return to Supplier" },
];

export function StockCell({ productId, initialStock, onSaved }: {
  productId: string;
  initialStock: number;
  onSaved: (id: string, stock: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(initialStock));
  const [reason, setReason] = useState("manual_adjustment");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const newStock = parseInt(value, 10);
    if (isNaN(newStock) || newStock < 0) {
      setError("Invalid number");
      return;
    }
    if (newStock === initialStock) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch(apiUrl(`/admin/products/${productId}/stock`), {
        method: "PATCH",
        body: JSON.stringify({ stock: newStock, reason }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to update stock");
      }
      setSaving(false);
      setEditing(false);
      onSaved(productId, newStock);
    } catch (err: any) {
      setSaving(false);
      setError(err.message || "Save failed");
    }
  };

  const cancel = () => {
    setValue(String(initialStock));
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1 items-end py-1">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            className="w-16 px-2 py-0.5 rounded border border-primary bg-background text-sm text-right focus:outline-none"
            autoFocus
          />
          <button
            onClick={save}
            disabled={saving}
            className="p-1 rounded text-primary hover:bg-primary/10 transition disabled:opacity-50"
            title="Save adjustment"
          >
            <Check size={14} />
          </button>
          <button
            onClick={cancel}
            disabled={saving}
            className="p-1 rounded text-muted-foreground hover:bg-muted transition"
            title="Cancel"
          >
            <X size={14} />
          </button>
        </div>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="text-xs px-1.5 py-0.5 rounded border border-border bg-background text-foreground focus:outline-none max-w-[130px]"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setValue(String(initialStock));
        setReason(initialStock > 0 ? "stocktake_correction" : "manual_adjustment");
        setEditing(true);
      }}
      title="Click to edit stock with reason"
      className={`font-medium hover:underline cursor-text text-right w-full block ${
        initialStock === 0 ? "text-red-400" : initialStock < 5 ? "text-orange-400" : ""
      }`}
    >
      {saving ? "…" : initialStock}
    </button>
  );
}
