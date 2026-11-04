import { useState, useEffect } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";

interface AgedReservation {
  id: string;
  reservation_number: string;
  customer_name: string;
  customer_phone: string;
  agreed_price: number;
  paid_amount: number;
  quantity: number;
  status: string;
  effective_status: string;
  created_at: string;
  days_old?: number;
  variant_sku?: string | null;
  product_title?: string | null;
}

export function AgedReservationsList({ isOwner }: { isOwner: boolean }) {
  const [items, setItems] = useState<AgedReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [daysThreshold, setDaysThreshold] = useState("30");
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAged = () => {
    setLoading(true);
    adminFetch(apiUrl(`/admin/reservations/aged?threshold_days=${daysThreshold}`))
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { setItems(data); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  };

  useEffect(() => {
    fetchAged();
  }, [daysThreshold]);

  const handleRelease = async (id: string) => {
    if (!releaseReason.trim()) {
      alert("Release reason is required (e.g. 'Customer forfeited deposit' or 'Cash refunded').");
      return;
    }
    setActionLoading(true);
    try {
      const res = await adminFetch(apiUrl(`/admin/reservations/${id}/release`), {
        method: "POST",
        body: JSON.stringify({ release_reason: releaseReason.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to release reservation");
      }
      setReleaseId(null);
      setReleaseReason("");
      fetchAged();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold">Owner's Aged Deposits & Holds</h2>
          <span className="text-xs text-muted-foreground">({items.length} aged records)</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span>Threshold:</span>
          <select
            value={daysThreshold}
            onChange={(e) => setDaysThreshold(e.target.value)}
            className="px-2 py-1 rounded border border-border bg-background"
          >
            <option value="7">7+ days old</option>
            <option value="14">14+ days old</option>
            <option value="30">30+ days old (standard)</option>
            <option value="60">60+ days old</option>
          </select>
          <button onClick={fetchAged} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error && <div className="p-3 text-xs rounded bg-destructive/10 text-destructive">{error}</div>}

      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-muted-foreground text-left">
              <th className="px-3 py-2">Hold #</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Agreed</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-center">Effective State</th>
              <th className="px-3 py-2 text-center">Age</th>
              {isOwner && <th className="px-3 py-2 text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Loading aged records…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No deposits exceed the {daysThreshold}-day age threshold.</td></tr>
            ) : items.map((r) => {
              const days = r.days_old ?? Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
              return (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono font-medium">{r.reservation_number}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{r.customer_name}</p>
                    <a href={`tel:${r.customer_phone}`} className="text-muted-foreground hover:underline">{r.customer_phone}</a>
                  </td>
                  <td className="px-3 py-2">
                    <p className="line-clamp-1">{r.product_title ?? r.variant_sku ?? "Variant"}</p>
                    <span className="text-[10px] text-muted-foreground font-mono">{r.quantity} unit(s)</span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{Number(r.agreed_price).toFixed(2)} AZN</td>
                  <td className="px-3 py-2 text-right text-green-600 font-medium">{Number(r.paid_amount).toFixed(2)} AZN</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      r.effective_status === "expired" ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-600"
                    }`}>
                      {r.effective_status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="font-bold text-amber-600">{days}d</span>
                  </td>
                  {isOwner && (
                    <td className="px-3 py-2 text-right">
                      {releaseId === r.id ? (
                        <div className="flex flex-col gap-1 items-end">
                          <input
                            type="text"
                            placeholder="Reason (refund/forfeit)"
                            value={releaseReason}
                            onChange={(e) => setReleaseReason(e.target.value)}
                            className="px-2 py-0.5 rounded border border-border bg-background w-36"
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleRelease(r.id)}
                              disabled={actionLoading}
                              className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground font-semibold"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => { setReleaseId(null); setReleaseReason(""); }}
                              className="px-2 py-0.5 rounded border border-border text-muted-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReleaseId(r.id)}
                          className="px-2 py-1 rounded border border-destructive/30 hover:bg-destructive/10 text-destructive text-[11px] font-semibold"
                        >
                          Release Hold
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
