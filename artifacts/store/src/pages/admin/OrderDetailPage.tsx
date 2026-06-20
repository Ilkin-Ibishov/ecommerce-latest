import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useI18n } from "@/lib/i18n/context";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  phone_verified: "bg-blue-500/20 text-blue-400",
  courier_assigned: "bg-purple-500/20 text-purple-400",
  shipped: "bg-indigo-500/20 text-indigo-400",
  delivered: "bg-green-500/20 text-green-400",
  refused_at_delivery: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

const STATUS_KEY_MAP: Record<string, string> = {
  pending: "statusPending",
  phone_verified: "statusPhoneVerified",
  courier_assigned: "statusCourierAssigned",
  shipped: "statusShipped",
  delivered: "statusDelivered",
  refused_at_delivery: "statusRefusedAtDelivery",
  cancelled: "statusCancelled",
};

const NOTIF_STATUS_COLORS: Record<string, string> = {
  sent: "bg-green-500/20 text-green-400",
  pending: "bg-yellow-500/20 text-yellow-400",
  retrying: "bg-orange-500/20 text-orange-400",
  failed: "bg-red-500/20 text-red-400",
};

const NOTIF_TYPE_KEY_MAP: Record<string, string> = {
  order_confirmed: "notifTypeOrderConfirmed",
  status_changed: "notifTypeStatusChanged",
  low_stock: "notifTypeLowStock",
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
  const { t } = useI18n();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newStatus, setNewStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Admin notes state
  const [adminNotes, setAdminNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // WhatsApp notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string>("");

  const getStatusLabel = (status: string) => {
    const key = STATUS_KEY_MAP[status];
    return key ? t(`Admin.OrderDetail.${key}`) : status;
  };

  const getNotifTypeLabel = (type: string) => {
    const key = NOTIF_TYPE_KEY_MAP[type];
    return key ? t(`Admin.OrderDetail.${key}`) : type;
  };

  useEffect(() => {
    const supabase = createClient();
    supabase.from("orders")
      .select("*, order_items(*, products(slug, product_translations(lang_code,title))), coupons(code)")
      .eq("id", id).single()
      .then(({ data }) => {
        setOrder(data);
        setNewStatus(data?.status ?? "");
        setAdminNotes(data?.admin_notes ?? "");
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
        setError(data.error ?? t("Admin.OrderDetail.failedToUpdate"));
      } else {
        setOrder((prev: any) => ({ ...prev, status: newStatus }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError(t("Admin.Common.networkError"));
    }
    setSaving(false);
  };

  const handleSaveNotes = async () => {
    setNotesSaving(true);
    await adminFetch(apiUrl(`/admin/orders/${id}/notes`), {
      method: "PATCH",
      body: JSON.stringify({ notes: adminNotes }),
    });
    setNotesSaving(false);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
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
      setTestResult(data.ok ? `✓ ${t("Admin.OrderDetail.sent")}` : `${t("Admin.Common.networkError")}: ${data.error ?? "unknown"}`);
    } catch {
      setTestResult(t("Admin.Common.networkError"));
    }
    setTestSending(false);
  };

  if (loading) return <div className="text-muted-foreground">{t("Admin.Common.loading")}</div>;
  if (!order) return (
    <div className="space-y-4">
      <Link href="/admin/orders" className="text-sm text-muted-foreground hover:text-foreground">{t("Admin.OrderDetail.backToOrders")}</Link>
      <p className="text-muted-foreground">{t("Admin.OrderDetail.notFound")}</p>
    </div>
  );

  const statusClass = STATUS_COLORS[order.status] ?? "bg-gray-500/20 text-gray-400";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground text-sm no-print">{t("Admin.OrderDetail.backToOrders")}</Link>
        <h1 className="text-2xl font-bold">{t("Admin.OrderDetail.orderTitle").replace("{id}", order.id.slice(0, 8).toUpperCase())}</h1>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass}`}>
          {getStatusLabel(order.status)}
        </span>
        <button
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition no-print"
        >
          <Printer size={14} /> {t("Admin.OrderDetail.print")}
        </button>
      </div>

      {/* Print-only store header */}
      <div className="hidden print:block border-b pb-4 mb-4">
        <p className="text-lg font-bold">{t("Admin.OrderDetail.deliveryReceipt")}</p>
        <p className="text-sm text-gray-500">{new Date(order.created_at).toLocaleDateString("az-AZ", { year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      {error && <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg no-print">{error}</div>}

      {/* Customer + Order info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-sm">{t("Admin.OrderDetail.sectionCustomer")}</h2>
          <div className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">{t("Admin.OrderDetail.fieldName")}</span> {order.customer_name}</p>
            <p><span className="text-muted-foreground">{t("Admin.OrderDetail.fieldPhone")}</span> {order.customer_phone}</p>
            <p><span className="text-muted-foreground">{t("Admin.OrderDetail.fieldAddress")}</span> {order.delivery_address}</p>
            {order.notes && <p><span className="text-muted-foreground">{t("Admin.OrderDetail.fieldNotes")}</span> {order.notes}</p>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-sm">{t("Admin.OrderDetail.sectionOrderInfo")}</h2>
          <div className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">{t("Admin.OrderDetail.fieldPlaced")}</span> {new Date(order.created_at).toLocaleString()}</p>
            <p><span className="text-muted-foreground">{t("Admin.OrderDetail.fieldSubtotal")}</span> {Number(order.subtotal_azn ?? order.total_azn).toFixed(2)} AZN</p>
            {Number(order.discount_azn) > 0 && (
              <p><span className="text-muted-foreground">{t("Admin.OrderDetail.fieldDiscount")}</span> -{Number(order.discount_azn).toFixed(2)} AZN {order.coupons?.code && `(${order.coupons.code})`}</p>
            )}
            <p className="font-bold"><span className="text-muted-foreground font-normal">{t("Admin.OrderDetail.fieldTotal")}</span> {Number(order.total_azn).toFixed(2)} AZN</p>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-sm">{t("Admin.OrderDetail.sectionItems")}</h2>
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

      {/* Update Status — hidden on print */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3 no-print">
        <h2 className="font-semibold text-sm">{t("Admin.OrderDetail.sectionUpdateStatus")}</h2>
        {newStatus === "cancelled" && order.status !== "cancelled" && (
          <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
            ⚠ {t("Admin.OrderDetail.cancelWarning")}
          </div>
        )}
        <div className="flex gap-3 flex-wrap">
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{getStatusLabel(s)}</option>
            ))}
          </select>
          <button onClick={handleSaveStatus} disabled={saving || newStatus === order.status}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {saving ? t("Admin.Common.saving") : saved ? t("Admin.OrderDetail.saved") : t("Admin.OrderDetail.saveStatus")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("Admin.OrderDetail.whatsappAutoNotice")}</p>
      </div>

      {/* Admin Notes — hidden on print */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3 no-print">
        <h2 className="font-semibold text-sm">{t("Admin.OrderDetail.sectionAdminNotes")} <span className="text-xs font-normal text-muted-foreground">{t("Admin.OrderDetail.adminNotesSubtitle")}</span></h2>
        <textarea
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
          rows={3}
          placeholder={t("Admin.OrderDetail.notesPlaceholder")}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <button
          onClick={handleSaveNotes}
          disabled={notesSaving}
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition disabled:opacity-50"
        >
          {notesSaving ? t("Admin.Common.saving") : notesSaved ? t("Admin.OrderDetail.saved") : t("Admin.OrderDetail.saveNotes")}
        </button>
      </div>

      {/* WhatsApp Notifications Log — hidden on print */}
      <div className="bg-card border border-border rounded-xl overflow-hidden no-print">
        <button
          onClick={() => setNotifsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold hover:bg-muted/30 transition"
        >
          <span className="flex items-center gap-2">
            <span>📱 {t("Admin.OrderDetail.sectionNotifications")}</span>
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
              <p className="text-sm text-muted-foreground">{t("Admin.OrderDetail.noNotifications")}</p>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div key={n.id} className="flex flex-wrap items-start gap-2 text-xs py-2 border-b border-border last:border-0">
                    <span className="font-mono text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{n.channel}</span>
                    <span className="text-muted-foreground">{getNotifTypeLabel(n.type)}</span>
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${NOTIF_STATUS_COLORS[n.status] ?? "bg-gray-500/20 text-gray-400"}`}>
                      {n.status}
                    </span>
                    {n.error_message && (
                      <span className="text-red-400 truncate max-w-xs" title={n.error_message}>{n.error_message}</span>
                    )}
                    {n.status === "failed" && (
                      <button
                        onClick={async () => {
                          await adminFetch(apiUrl(`/admin/notifications/${n.id}/retry`), { method: "POST" });
                          setSaved((v) => !v);
                        }}
                        className="ml-auto px-2 py-0.5 rounded bg-primary/10 text-primary text-xs hover:bg-primary/20 transition shrink-0"
                      >
                        {t("Admin.Common.retry")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Test message sender */}
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">{t("Admin.OrderDetail.testMessage")}</p>
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
                  {testSending ? "…" : t("Admin.OrderDetail.send")}
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
