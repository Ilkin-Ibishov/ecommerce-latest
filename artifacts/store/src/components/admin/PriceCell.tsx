import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

interface PriceCellProps {
  productId: string;
  initialPrice: number;
  onSaved: (id: string, price: number) => void;
}

export function PriceCell({ productId, initialPrice, onSaved }: PriceCellProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(initialPrice));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const newPrice = parseFloat(value);
    if (isNaN(newPrice) || newPrice < 0 || newPrice === initialPrice) {
      setValue(String(initialPrice)); setEditing(false); return;
    }
    setSaving(true);
    await adminFetch(apiUrl(`/admin/products/${productId}`), {
      method: "PATCH",
      body: JSON.stringify({ price: newPrice }),
    });
    setSaving(false); setEditing(false);
    onSaved(productId, newPrice);
  };

  if (editing) {
    return (
      <input
        type="number" min={0} step="0.01" value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setValue(String(initialPrice)); setEditing(false); }
        }}
        className="w-20 px-2 py-1 rounded border border-primary bg-background text-sm text-right focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => { setValue(String(initialPrice)); setEditing(true); }}
      title="Click to edit price"
      className="font-medium hover:underline cursor-text text-right w-full block"
    >
      {saving ? "…" : `${initialPrice.toFixed(2)}`}
    </button>
  );
}
