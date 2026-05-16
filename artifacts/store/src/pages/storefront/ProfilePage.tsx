import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { LoginModal } from "@/components/auth/LoginModal";
import { Package, Clock, MapPin, ChevronDown, ChevronUp } from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700" },
  phone_verified: { label: "Confirmed", color: "bg-blue-100 text-blue-700" },
  courier_assigned: { label: "Courier Assigned", color: "bg-indigo-100 text-indigo-700" },
  shipped: { label: "Shipped", color: "bg-purple-100 text-purple-700" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700" },
  refused_at_delivery: { label: "Refused", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500" },
};

function OrderCard({ order }: { order: any }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_LABELS[order.status] ?? { label: order.status, color: "bg-gray-100 text-gray-500" };

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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock size={12} />
            {new Date(order.created_at).toLocaleString()}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin size={12} />
            {order.delivery_address}
          </div>
          {order.discount_azn > 0 && (
            <p className="text-xs text-green-600 font-medium">Discount applied: -{Number(order.discount_azn).toFixed(2)} AZN</p>
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
        </div>
      )}
    </div>
  );
}

export default function ProfilePage({ locale }: { locale: string }) {
  const [user, setUser] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      if (!data.user) { setLoading(false); return; }
      loadOrders(data.user);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadOrders(session.user);
      else { setOrders([]); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadOrders = async (u: any) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl("/profile/orders"), {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) setOrders(await res.json());
    } catch {}
    setLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setOrders([]);
  };

  if (!user && !loading) {
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

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Profile</h1>
          <p className="text-muted-foreground text-sm mt-1">{user?.phone ?? user?.email ?? "—"}</p>
        </div>
        <button onClick={handleSignOut}
          className="text-sm text-muted-foreground hover:text-destructive transition border border-border px-4 py-2 rounded-lg">
          Sign Out
        </button>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Package size={18} /> My Orders
          {orders.length > 0 && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{orders.length}</span>}
        </h2>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
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
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
