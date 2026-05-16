import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  phone_verified: "bg-blue-500/20 text-blue-400",
  courier_assigned: "bg-purple-500/20 text-purple-400",
  shipped: "bg-indigo-500/20 text-indigo-400",
  delivered: "bg-green-500/20 text-green-400",
  refused_at_delivery: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

const ALL_STATUSES = ["pending", "phone_verified", "courier_assigned", "shipped", "delivered", "refused_at_delivery", "cancelled"];

export default function OrderDetailPage({ id }: { id: string }) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newStatus, setNewStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (supabase as any).from("orders")
      .select("*, order_items(*, products(slug, product_translations(lang_code,title))), coupons(code)")
      .eq("id", id).single()
      .then(({ data }: any) => {
        setOrder(data);
        setNewStatus(data?.status ?? "");
        setLoading(false);
      });
  }, [id]);

  const handleSaveStatus = async () => {
    if (newStatus === order.status) return;
    setSaving(true);
    await fetch(apiUrl(`/admin/orders/${id}/status`), {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setOrder((prev: any) => ({ ...prev, status: newStatus }));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!order) return (
    <div>
      <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground text-sm">← Orders</Link>
      <p className="mt-4 text-muted-foreground">Order not found.</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground text-sm transition">← Orders</Link>
        <h1 className="text-xl font-bold">Order #{id.slice(0, 8).toUpperCase()}</h1>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground"}`}>
          {String(order.status).replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">Customer</h2>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Name:</span> {order.customer_name}</p>
            <p><span className="text-muted-foreground">Phone:</span> {order.customer_phone}</p>
            <p><span className="text-muted-foreground">Address:</span> {order.delivery_address}</p>
            {order.notes && <p><span className="text-muted-foreground">Notes:</span> {order.notes}</p>}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">Financials</h2>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Subtotal:</span> {(Number(order.total_azn) + Number(order.discount_azn)).toFixed(2)} AZN</p>
            {Number(order.discount_azn) > 0 && (
              <p className="text-green-400">
                <span className="text-muted-foreground">Discount:</span> -{Number(order.discount_azn).toFixed(2)} AZN
                {order.coupons?.code && ` (${order.coupons.code})`}
              </p>
            )}
            <p className="font-bold text-lg mt-2">Total: {Number(order.total_azn).toFixed(2)} AZN</p>
            <p className="text-muted-foreground text-xs">Cash on delivery</p>
          </div>
          <div className="pt-2 text-xs text-muted-foreground">Placed: {new Date(order.created_at).toLocaleString()}</div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border font-semibold">Items</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-5 py-3 font-medium">Product</th>
              <th className="text-right px-5 py-3 font-medium">Unit Price</th>
              <th className="text-right px-5 py-3 font-medium">Qty</th>
              <th className="text-right px-5 py-3 font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {(order.order_items ?? []).map((item: any) => (
              <tr key={item.id} className="border-b border-border/50">
                <td className="px-5 py-3">{item.product_title_snapshot}</td>
                <td className="px-5 py-3 text-right">{Number(item.product_price_snapshot).toFixed(2)} AZN</td>
                <td className="px-5 py-3 text-right">{item.quantity}</td>
                <td className="px-5 py-3 text-right font-medium">{Number(item.line_total).toFixed(2)} AZN</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Update Status</h2>
        <div className="flex gap-3 flex-wrap">
          {ALL_STATUSES.map((s) => (
            <button key={s} onClick={() => setNewStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${newStatus === s ? "bg-primary text-primary-foreground font-medium" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <button onClick={handleSaveStatus} disabled={saving || newStatus === order.status}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
          {saving ? "Saving…" : saved ? "Saved!" : "Save Status"}
        </button>
      </div>
    </div>
  );
}
