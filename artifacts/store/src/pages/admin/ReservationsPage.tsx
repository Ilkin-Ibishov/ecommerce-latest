import { useState, useEffect } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { createClient } from "@/lib/supabase/client";
import { CreateDepositModal } from "@/components/admin/CreateDepositModal";
import { AgedReservationsList } from "@/components/admin/AgedReservationsList";
import { BookmarkCheck, Plus, Search, CheckCircle, DollarSign, Clock } from "lucide-react";

interface ReservationItem {
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
  expires_at: string | null;
  product_title?: string | null;
  variant_sku?: string | null;
}

export default function ReservationsPage() {
  const [items, setItems] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"active" | "aged" | "all">("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [payModal, setPayModal] = useState<{ id: string; agreed: number; paid: number } | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const loadRole = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("users").select("role").eq("id", user.id).single();
    if (data?.role === "admin") setIsOwner(true);
  };

  const loadReservations = () => {
    setLoading(true);
    adminFetch(apiUrl(`/admin/reservations${tab === "active" ? "?status=active" : ""}`))
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadRole(); }, []);
  useEffect(() => { if (tab !== "aged") loadReservations(); }, [tab]);

  const handlePayAndCollect = async (res: ReservationItem) => {
    const shortfall = Math.max(0, Number(res.agreed_price) - Number(res.paid_amount));
    if (shortfall > 0) {
      if (!confirm(`Collect final balance of ${shortfall.toFixed(2)} AZN and fulfil reservation?`)) return;
    }
    try {
      const response = await adminFetch(apiUrl(`/admin/reservations/${res.id}/fulfil`), {
        method: "POST",
        body: JSON.stringify({ final_payment: shortfall }),
      });
      if (!response.ok) {
        const j = await response.json().catch(() => ({}));
        throw new Error(j.error || "Fulfilment failed");
      }
      loadReservations();
    } catch (e: any) { alert(e.message); }
  };

  const handlePartialPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) return alert("Invalid payment amount");
    try {
      const res = await adminFetch(apiUrl(`/admin/reservations/${payModal.id}/payment`), {
        method: "POST",
        body: JSON.stringify({ amount: amt }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Payment failed");
      }
      setPayModal(null);
      setPayAmount("");
      loadReservations();
    } catch (e: any) { alert(e.message); }
  };

  const filtered = items.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.customer_name.toLowerCase().includes(q) ||
      r.customer_phone.includes(q) ||
      r.reservation_number.toLowerCase().includes(q) ||
      (r.variant_sku?.toLowerCase().includes(q) ?? false);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookmarkCheck className="text-primary" />
            Deposits & Customer Holds
          </h1>
          <p className="text-xs text-muted-foreground">Fast counter reservation management, pay-and-collect, and aged stock holds.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition shadow-sm"
        >
          <Plus size={14} /> New Counter Deposit (&lt; 1 min)
        </button>
      </div>

      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setTab("active")}
          className={`pb-2 px-3 text-xs font-semibold border-b-2 transition ${tab === "active" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Active Counter Holds
        </button>
        <button
          onClick={() => setTab("aged")}
          className={`pb-2 px-3 text-xs font-semibold border-b-2 transition flex items-center gap-1 ${tab === "aged" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          <Clock size={13} /> Owner's Aged Holds
        </button>
        <button
          onClick={() => setTab("all")}
          className={`pb-2 px-3 text-xs font-semibold border-b-2 transition ${tab === "all" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          All History
        </button>
      </div>

      {tab === "aged" ? (
        <AgedReservationsList isOwner={isOwner} />
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by customer phone, name, hold #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs"
            />
          </div>

          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground text-left">
                  <th className="px-3 py-2.5">Hold #</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">Agreed</th>
                  <th className="px-3 py-2.5 text-right">Paid</th>
                  <th className="px-3 py-2.5 text-right">Shortfall</th>
                  <th className="px-3 py-2.5 text-center">State</th>
                  <th className="px-3 py-2.5 text-right">Counter Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Loading deposits…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No reservations found.</td></tr>
                ) : filtered.map((r) => {
                  const shortfall = Math.max(0, Number(r.agreed_price) - Number(r.paid_amount));
                  const isActive = r.effective_status === "active";
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
                      <td className="px-3 py-2 text-right font-medium text-amber-600">{shortfall.toFixed(2)} AZN</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          r.effective_status === "fulfilled" ? "bg-green-500/10 text-green-600" :
                          r.effective_status === "expired" ? "bg-red-500/10 text-red-600" :
                          r.effective_status === "released" ? "bg-muted text-muted-foreground" :
                          "bg-primary/10 text-primary"
                        }`}>
                          {r.effective_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isActive && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handlePayAndCollect(r)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-green-600 text-white font-semibold hover:bg-green-700 shadow-sm"
                              title="1-click pay shortfall and release goods"
                            >
                              <CheckCircle size={11} /> Pay &amp; Collect
                            </button>
                            <button
                              onClick={() => { setPayModal({ id: r.id, agreed: Number(r.agreed_price), paid: Number(r.paid_amount) }); setPayAmount(String(shortfall)); }}
                              className="inline-flex items-center gap-0.5 px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground"
                            >
                              <DollarSign size={11} /> Pay
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <form onSubmit={handlePartialPayment} className="bg-card border border-border rounded-xl p-5 max-w-xs w-full space-y-3 text-xs shadow-xl">
            <h3 className="font-semibold text-sm">Record Partial Payment</h3>
            <p className="text-muted-foreground">Agreed: {payModal.agreed.toFixed(2)} AZN | Paid: {payModal.paid.toFixed(2)} AZN</p>
            <div>
              <label className="block mb-1 font-medium">Payment Amount (AZN)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={payModal.agreed - payModal.paid}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
                required
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button type="button" onClick={() => setPayModal(null)} className="px-3 py-1 rounded border border-border">Cancel</button>
              <button type="submit" className="px-3 py-1 rounded bg-primary text-primary-foreground font-semibold">Record Payment</button>
            </div>
          </form>
        </div>
      )}

      <CreateDepositModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={loadReservations} />
    </div>
  );
}
