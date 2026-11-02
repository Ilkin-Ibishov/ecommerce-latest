import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { X, History, ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";

interface MovementRecord {
  id: string;
  variant_id: string;
  quantity_delta: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  unit_cost: number | null;
  note: string | null;
  created_at: string;
  users: { id: string; full_name: string | null; role: string } | null;
}

const REASON_LABELS: Record<string, string> = {
  goods_receipt: "Goods Receipt",
  online_sale: "Online Sale",
  counter_sale: "Counter Sale",
  customer_return: "Customer Return",
  return_to_supplier: "Return to Supplier",
  damage_write_off: "Damage / Write-off",
  stocktake_correction: "Stocktake Correction",
  manual_adjustment: "Manual Adjustment",
  opening_balance: "Opening Balance",
  assembly_consume: "Assembly Consume",
  assembly_produce: "Assembly Produce",
};

export function VariantMovementHistoryModal({
  variantId,
  variantLabel,
  onClose,
}: {
  variantId: string;
  variantLabel: string;
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminFetch(apiUrl(`/admin/variants/${variantId}/movements`));
        if (!res.ok) throw new Error("Failed to load movement history");
        const json = await res.json();
        setMovements(json.movements || []);
      } catch (err: any) {
        setError(err.message || "Failed to load movements");
      } finally {
        setLoading(false);
      }
    })();
  }, [variantId]);

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <History className="text-primary" size={20} />
            <div>
              <h2 className="font-semibold text-lg">Stock Movement Ledger</h2>
              <p className="text-xs text-muted-foreground">{variantLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
              <Clock className="animate-spin" size={16} /> Loading audit trail...
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
          ) : movements.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No movements recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {movements.map((m) => {
                const isPositive = Number(m.quantity_delta) > 0;
                const formattedDate = new Date(m.created_at).toLocaleString();
                const reasonLabel = REASON_LABELS[m.reason] || m.reason;
                const actorName = m.users?.full_name || m.users?.role || "System";

                return (
                  <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/30 transition text-sm">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isPositive ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"}`}>
                        {isPositive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{reasonLabel}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            by {actorName}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span>{formattedDate}</span>
                          {m.note && <span>• {m.note}</span>}
                          {m.reference_id && <span>• Ref: {m.reference_id}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`font-semibold font-mono text-base ${isPositive ? "text-emerald-500" : "text-destructive"}`}>
                        {isPositive ? `+${m.quantity_delta}` : m.quantity_delta}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
