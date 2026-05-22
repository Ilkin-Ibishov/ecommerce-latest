import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  phone_verified: "bg-blue-500/20 text-blue-400",
  courier_assigned: "bg-purple-500/20 text-purple-400",
  shipped: "bg-indigo-500/20 text-indigo-400",
  delivered: "bg-green-500/20 text-green-400",
  refused_at_delivery: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  phone_verified: "Phone Verified",
  courier_assigned: "Courier Assigned",
  shipped: "Shipped",
  delivered: "Delivered",
  refused_at_delivery: "Refused at Delivery",
  cancelled: "Cancelled",
};

const NOTIF_STATUS_COLORS: Record<string, string> = {
  sent: "bg-green-500/20 text-green-400",
  pending: "bg-yellow-500/20 text-yellow-400",
  retrying: "bg-orange-500/20 text-orange-400",
  failed: "bg-red-500/20 text-red-400",
};

const NOTIF_TYPE_LABELS: Record<string, string> = {
  order_confirmed: "Sifariş təsdiqi",
  status_changed: "Status dəyişikliyi",
  low_stock: "Az stok",
};

const ALL_STATUSES = ["pending", "phone_verified", "courier_assigned", "shipped", "delivered", "refused_at_delivery", "cancelled"];

type Notification = {
  id: string;
  type: string;
  channel: string;
  recipient: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  attempts: number;
  error_message: string | null;
};

export default function OrderDetailPage({ id }: { id: string }) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newStatus, setNewStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string>("");

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

  useEffect(() => {
    if (!id) return;
    adminFetch(apiUrl(`/admin/orders/${id}/notifications`))
      .then((r) => r.ok ? r.json() : [])
      .then(setNotifications)
      .catch(() => {});
  }, [id, saved]);

  const handleSaveStatus = async () => {
    if (newStatus === order.status) return;
    setSaving(true); setError("");
    try {
      const res = await adminFetch(apiUrl(`/admin/orders/${id}/status`), {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to update status");
      } else {
        setOrder((prev: any) => ({ ...prev, status: newStatus }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Network error");
    }
    setSaving(false);
  };

  const handleTestSend = async () => {
    if (!testPhone) return;
    setTestSending(true); setTestResult("");
    try {
      const res = await adminFetch(apiUrl("/admin/whatsapp/test"), {
        method: "POST",
        body: JSON.stringify({ phone: testPhone }),
      });
      const data = await res.json();
      setTestResult(data.ok ? "✓ Göndərildi" : `Xəta: ${data.error ?? "unknown"}`);
    } catch {
      setTestResult("Şəbəkə xətası");
    }
    setTestSending(false);
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!order) return (
    <div className="space-y-4">
      <Link href="/admin/orders" className="text-sm text-muted-foreground hover:text-foreground">← Orders</Link>
      <p className="text-muted-foreground">Order not found.</p>
    </div>
  );

  const statusClass = STATUS_COLORS[order.status] ?? "bg-gray-500/20 text-gray-400";

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground text-sm">← Orders</Link>
        <h1 className="text-2xl font-bold">Order #{order.id.slice(0, 8).toUpperCase()}</h1>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass}`}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      {error && <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-sm">Customer</h2>
          <div className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Name:</span> {order.customer_name}</p>
            <p><span className="text-muted-foreground">Phone:</span> {order.customer_phone}</p>
            <p><span className="text-muted-foreground">Address:</span> {order.delivery_address}</p>
            {order.notes && <p><span className="text-muted-foreground">Notes:</span> {order.notes}</p>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-sm">Order Info</h2>
          <div className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Placed:</span> {new Date(order.created_at).toLocaleString()}</p>
            <p><span className="text-muted-foreground">Subtotal:</span> {Number(order.subtotal_azn ?? order.total_azn).toFixed(2)} AZN</p>
            {Number(order.discount_azn) > 0 && (
              <p><span className="text-muted-foreground">Discount:</span> -{Number(order.discount_azn).toFixed(2)} AZN {order.coupons?.code && `(${order.coupons.code})`}</p>
            )}
            <p className="font-bold"><span className="text-muted-foreground font-normal">Total:</span> {Number(order.total_azn).toFixed(2)} AZN</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-sm">Items</h2>
        <div className="divide-y divide-border">
          {(order.order_items ?? []).map((item: any) => (
            <div key={item.id} className="flex justify-between py-2 text-sm">
              <span className="text-muted-foreground">
                {item.product_title_snapshot ?? item.products?.product_translations?.[0]?.title ?? "Product"} ×{item.quantity}
              </span>
              <span className="font-medium">{Number(item.line_total).toFixed(2)} AZN</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-sm">Update Status</h2>
        {newStatus === "cancelled" && order.status !== "cancelled" && (
          <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
            ⚠ Cancelling this order will automatically restock all items.
          </div>
        )}
        <div className="flex gap-3 flex-wrap">
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
            ))}
          </select>
          <button onClick={handleSaveStatus} disabled={saving || newStatus === order.status}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save Status"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">WhatsApp bildirişi avtomatik göndəriləcək.</p>
      </div>

      {/* WhatsApp Notifications Log */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setNotifsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold hover:bg-muted/30 transition"
        >
          <span className="flex items-center gap-2">
            <span>📱 WhatsApp Bildirişləri</span>
            {notifications.length > 0 && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {notifications.length}
              </span>
            )}
          </span>
          <span className="text-muted-foreground">{notifsOpen ? "▲" : "▼"}</span>
        </button>

        {notifsOpen && (
          <div className="border-t border-border px-5 py-4 space-y-3">
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu sifariş üçün bildiriş yoxdur.</p>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div key={n.id} className="flex flex-wrap items-start gap-2 text-xs py-2 border-b border-border last:border-0">
                    <span className="font-mono text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{n.channel}</span>
                    <span className="text-muted-foreground">{NOTIF_TYPE_LABELS[n.type] ?? n.type}</span>
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${NOTIF_STATUS_COLORS[n.status] ?? "bg-gray-500/20 text-gray-400"}`}>
                      {n.status}
                    </span>
                    {n.error_message && (
                      <span className="text-red-400 truncate max-w-xs" title={n.error_message}>{n.error_message}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Test message sender */}
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">Test mesajı göndər:</p>
              <div className="flex gap-2">
                <input
                  type="tel"
                  placeholder="+994501234567"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={handleTestSend}
                  disabled={testSending || !testPhone}
                  className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-50"
                >
                  {testSending ? "…" : "Göndər"}
                </button>
              </div>
              {testResult && (
                <p className={`text-xs mt-1 ${testResult.startsWith("✓") ? "text-green-500" : "text-red-500"}`}>
                  {testResult}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
