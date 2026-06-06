import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

export function StockCell({ productId, initialStock, onSaved }: {
  productId: string;
  initialStock: number;
  onSaved: (id: string, stock: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(initialStock));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const newStock = parseInt(value, 10);
    if (isNaN(newStock) || newStock < 0 || newStock === initialStock) {
      setValue(String(initialStock)); setEditing(false); return;
    }
    setSaving(true);
    await adminFetch(apiUrl(`/admin/products/${productId}/stock`), {
      method: "PATCH",
      body: JSON.stringify({ stock: newStock }),
    });
    setSaving(false); setEditing(false);
    onSaved(productId, newStock);
  };

  if (editing) {
    return (
      <input
        type="number" min={0} value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setValue(String(initialStock)); setEditing(false); }
        }}
        className="w-16 px-2 py-1 rounded border border-primary bg-background text-sm text-right focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => { setValue(String(initialStock)); setEditing(true); }}
      title="Click to edit stock"
      className={`font-medium hover:underline cursor-text text-right w-full block ${
        initialStock === 0 ? "text-red-400" : initialStock < 5 ? "text-orange-400" : ""
      }`}
    >
      {saving ? "…" : initialStock}
    </button>
  );
}
