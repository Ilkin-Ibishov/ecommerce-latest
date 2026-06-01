import { useEffect, useState, useRef } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { LoginModal } from "@/components/auth/LoginModal";
import { useCart } from "@/lib/cart/context";
import { useProfile } from "@/lib/hooks/useProfile";
import {
  Package, Clock, MapPin, ChevronDown, ChevronUp,
  User, Edit2, Check, X, ShoppingCart, Home,
} from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700" },
  phone_verified: { label: "Confirmed", color: "bg-blue-100 text-blue-700" },
  courier_assigned: { label: "Courier Assigned", color: "bg-indigo-100 text-indigo-700" },
  shipped: { label: "Shipped", color: "bg-purple-100 text-purple-700" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700" },
  refused_at_delivery: { label: "Refused", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500" },
};

const STEPPER_STEPS = [
  { key: "pending", label: "Pending" },
  { key: "phone_verified", label: "Confirmed" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

const STEP_ORDER = ["pending", "phone_verified", "courier_assigned", "shipped", "delivered"];

function StatusStepper({ status }: { status: string }) {
  const isNegative = status === "refused_at_delivery" || status === "cancelled";
  const currentIdx = STEP_ORDER.indexOf(status);

  if (isNegative) {
    return (
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_LABELS[status]?.color ?? "bg-gray-100 text-gray-500"}`}>
        {STATUS_LABELS[status]?.label ?? status}
      </span>
    );
  }

  return (
    <div className="flex items-center w-full">
      {STEPPER_STEPS.map((step, idx) => {
        const stepOrderIdx = STEP_ORDER.indexOf(step.key);
        const isComplete = currentIdx >= stepOrderIdx;
        const isLast = idx === STEPPER_STEPS.length - 1;
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 transition-colors
                ${isComplete ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border text-muted-foreground"}`}>
                {isComplete ? <Check size={10} strokeWidth={3} /> : <span className="text-[9px] font-bold">{idx + 1}</span>}
              </div>
              <span className={`text-[9px] mt-0.5 text-center leading-tight whitespace-nowrap
                ${isComplete ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className={`h-0.5 flex-1 mx-1 mb-3 rounded ${currentIdx > stepOrderIdx ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({ order, locale }: { order: any; locale: string }) {
  const [expanded, setExpanded] = useState(false);
  const { addItem } = useCart();
  const status = STATUS_LABELS[order.status] ?? { label: order.status, color: "bg-gray-100 text-gray-500" };

  const handleReorder = (e: React.MouseEvent) => {
    e.stopPropagation();
    for (const item of order.order_items ?? []) {
      addItem({
        product_id: item.product_id ?? item.id,
        slug: item.product_id ?? "",
        title: item.product_title_snapshot,
        price: Number(item.product_price_snapshot),
        image: null,
      }, item.quantity);
    }
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Package size={18} className="text-primary" />
          </div>
          <div>
            <p className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8).toUpperCase()}</p>
            <p className="font-semibold text-sm">{Number(order.total_azn).toFixed(2)} AZN</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.color}`}>{status.label}</span>
          <span className="text-muted-foreground">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 bg-muted/30 space-y-3">
          <StatusStepper status={order.status} />

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock size={12} />
            {new Date(order.created_at).toLocaleString()}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin size={12} />
            {order.delivery_address}
          </div>
          {Number(order.discount_azn) > 0 && (
            <p className="text-xs text-green-600 font-medium">Discount: -{Number(order.discount_azn).toFixed(2)} AZN</p>
          )}
          <div className="space-y-2 pt-1">
            {(order.order_items ?? []).map((item: any) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground line-clamp-1 flex-1 mr-2">{item.product_title_snapshot} ×{item.quantity}</span>
                <span className="font-medium shrink-0">{Number(item.line_total).toFixed(2)} AZN</span>
              </div>
            ))}
          </div>
          {order.notes && (
            <p className="text-xs text-muted-foreground italic">Note: {order.notes}</p>
          )}
          {(order.order_items ?? []).length > 0 && (
            <button
              onClick={handleReorder}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition pt-1"
            >
              <ShoppingCart size={13} />
              Re-order all items
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function InlineEditor({
  label, value, onSave, readOnly = false, placeholder = "", multiline = false,
}: {
  label: string;
  value: string;
  onSave?: (v: string) => Promise<boolean>;
  readOnly?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    const ok = await onSave(draft.trim());
    setSaving(false);
    if (ok) setEditing(false);
  };

  const handleCancel = () => { setDraft(value); setEditing(false); };

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      {editing ? (
        <div className="flex gap-2 items-start">
          {multiline ? (
            <textarea
              ref={inputRef as any}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder={placeholder}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          ) : (
            <input
              ref={inputRef as any}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50 shrink-0"
          >
            <Check size={14} />
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="p-2 rounded-lg border border-border hover:bg-accent transition shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 min-h-[32px]">
          <p className={`text-sm ${value ? "" : "text-muted-foreground italic"}`}>
            {value || placeholder || "—"}
          </p>
          {!readOnly && onSave && (
            <button
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-primary transition shrink-0 p-1 rounded"
            >
              <Edit2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProfilePage({ locale }: { locale: string }) {
  const [user, setUser] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const supabase = createClient();
  const { profile, loading: profileLoading, updateProfile } = useProfile();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setPageLoading(false);
      if (data.user) loadOrders();
      else setOrdersLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadOrders();
      else { setOrders([]); setOrdersLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl("/profile/orders"), {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) setOrders(await res.json());
    } catch {}
    setOrdersLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setOrders([]);
  };

  if (pageLoading) {
    return <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <Package size={36} className="text-primary" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Your Profile</h1>
        <p className="text-muted-foreground mb-6">Sign in to view your orders and manage your account.</p>
        <button
          onClick={() => setShowLogin(true)}
          className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition"
        >
          Sign In with WhatsApp
        </button>
        <LoginModal open={showLogin} onClose={() => setShowLogin(false)} onSuccess={() => {}} />
      </div>
    );
  }

  const displayName = profile?.full_name || profile?.phone || user?.phone || user?.email || "there";

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Profile</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Welcome back, {displayName}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="text-sm text-muted-foreground hover:text-destructive transition border border-border px-4 py-2 rounded-lg"
        >
          Sign Out
        </button>
      </div>

      {/* ── Personal Info ── */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2 text-base">
          <User size={16} /> Personal Info
        </h2>
        {profileLoading ? (
          <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
        ) : (
          <>
            <InlineEditor
              label="Phone number"
              value={profile?.phone ?? user?.phone ?? ""}
              readOnly
            />
            <InlineEditor
              label="Full name"
              value={profile?.full_name ?? ""}
              placeholder="Add your name"
              onSave={(v) => updateProfile({ full_name: v })}
            />
          </>
        )}
      </section>

      {/* ── Default Delivery Address ── */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2 text-base">
          <Home size={16} /> Default Delivery Address
        </h2>
        {profileLoading ? (
          <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
        ) : (
          <>
            <InlineEditor
              label="Address"
              value={profile?.default_address ?? ""}
              placeholder="City, street, house number"
              multiline
              onSave={(v) => updateProfile({ default_address: v })}
            />
            <p className="text-xs text-muted-foreground">
              Saved here will auto-fill the address field at checkout.
            </p>
          </>
        )}
      </section>

      {/* ── Orders ── */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Package size={18} /> My Orders
          {orders.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{orders.length}</span>
          )}
        </h2>

        {ordersLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <Package size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No orders yet.</p>
            <Link href={`/${locale}/products`} className="text-primary hover:underline text-sm mt-2 inline-block">
              Start shopping
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} locale={locale} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
