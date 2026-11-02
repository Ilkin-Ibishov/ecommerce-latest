import { useState, useEffect } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { VariantMovementHistoryModal } from "./VariantMovementHistoryModal";
import { Plus, History, Layers, AlertCircle } from "lucide-react";

interface VariantItem {
  id: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  on_hand: number;
  unit_of_measure: string;
  is_default: boolean;
  sort_order: number;
}

export function ProductVariantManager({
  productId,
  userRole = "admin",
}: {
  productId: string;
  userRole?: string;
}) {
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeHistoryVariant, setActiveHistoryVariant] = useState<VariantItem | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New variant state
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState(0);
  const [initialQty, setInitialQty] = useState(0);
  const [uom, setUom] = useState("pcs");
  const [costPrice, setCostPrice] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVariants = async () => {
    try {
      const res = await adminFetch(apiUrl(`/admin/products/${productId}/variants`));
      if (!res.ok) return;
      const json = await res.json();
      setVariants(json.variants || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVariants();
  }, [productId]);

  const handleCreateVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch(apiUrl(`/admin/products/${productId}/variants`), {
        method: "POST",
        body: JSON.stringify({
          sku: sku.trim() || null,
          barcode: barcode.trim() || null,
          price: Number(price),
          initial_quantity: Number(initialQty),
          unit_of_measure: uom.trim() || "pcs",
          cost_price: userRole === "admin" ? Number(costPrice) : 0,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to create variant");
      }
      setShowAddForm(false);
      setSku(""); setBarcode(""); setPrice(0); setInitialQty(0);
      await fetchVariants();
    } catch (err: any) {
      setError(err.message || "Failed to create variant");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="text-primary" size={20} />
          <div>
            <h2 className="font-semibold">Product Variants & Stock</h2>
            <p className="text-xs text-muted-foreground">Variants are the sellable unit of inventory. Stock is append-only.</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm hover:bg-primary/20 transition"
        >
          <Plus size={14} /> {showAddForm ? "Cancel" : "Add Variant"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleCreateVariant} className="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
          <h3 className="text-sm font-semibold">New Variant Details</h3>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">SKU</label>
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. TSH-RED-L" className="w-full px-2.5 py-1.5 text-sm rounded border border-border bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Barcode (Scan)</label>
              <input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="e.g. 4006381333931" className="w-full px-2.5 py-1.5 text-sm rounded border border-border bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Price (AZN)</label>
              <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="w-full px-2.5 py-1.5 text-sm rounded border border-border bg-background" required />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Initial Stock (Opening Balance)</label>
              <input type="number" min={0} value={initialQty} onChange={(e) => setInitialQty(Number(e.target.value))} className="w-full px-2.5 py-1.5 text-sm rounded border border-border bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Unit of Measure</label>
              <input value={uom} onChange={(e) => setUom(e.target.value)} className="w-full px-2.5 py-1.5 text-sm rounded border border-border bg-background" />
            </div>
            {userRole === "admin" && (
              <div>
                <label className="text-xs text-muted-foreground">Cost Price (Admin Only)</label>
                <input type="number" min={0} step="0.01" value={costPrice} onChange={(e) => setCostPrice(Number(e.target.value))} className="w-full px-2.5 py-1.5 text-sm rounded border border-border bg-background" />
              </div>
            )}
          </div>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {saving ? "Saving..." : "Create Variant"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading variants...</p>
      ) : variants.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No variants created yet.</p>
      ) : (
        <div className="space-y-2">
          {variants.map((v) => (
            <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/20 transition">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${v.is_default ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {v.is_default ? "Default" : "Variant"}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{v.sku || "No SKU"}</span>
                    {v.barcode && <span className="text-xs text-muted-foreground font-mono">[{v.barcode}]</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{v.price.toFixed(2)} AZN • {v.unit_of_measure}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className={`font-mono text-sm font-bold ${v.on_hand <= 0 ? "text-destructive" : v.on_hand < 5 ? "text-orange-400" : "text-emerald-500"}`}>
                    {v.on_hand} on hand
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveHistoryVariant(v)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition"
                  title="View immutable movement ledger"
                >
                  <History size={13} /> Audit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {userRole === "staff" && (
        <div className="flex items-center gap-2 text-xs text-amber-500/90 pt-1">
          <AlertCircle size={14} />
          <span>Staff account: Prices are read-only and wholesale costs are hidden.</span>
        </div>
      )}

      {activeHistoryVariant && (
        <VariantMovementHistoryModal
          variantId={activeHistoryVariant.id}
          variantLabel={`Variant: ${activeHistoryVariant.sku || activeHistoryVariant.id} (${activeHistoryVariant.price} AZN)`}
          onClose={() => setActiveHistoryVariant(null)}
        />
      )}
    </div>
  );
}
