import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  phone_verified: "bg-blue-500/20 text-blue-400",
  courier_assigned: "bg-purple-500/20 text-purple-400",
  shipped: "bg-indigo-500/20 text-indigo-400",
  delivered: "bg-green-500/20 text-green-400",
  refused_at_delivery: "bg-red-500/20 text-red-400",
};

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalOrders: 0, revenue: 0, products: 0, lowStock: 0, pending: 0 });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [ordersRes, productsRes, recentRes] = await Promise.all([
        (supabase as any).from("orders").select("id, status, total_azn, created_at"),
        (supabase as any).from("products").select("id, stock, is_featured"),
        (supabase as any).from("orders").select("id, status, total_azn, customer_name, customer_phone, created_at").order("created_at", { ascending: false }).limit(10),
      ]);
      const orders = ordersRes.data ?? [];
      const products = productsRes.data ?? [];
      setStats({
        totalOrders: orders.length,
        revenue: orders.reduce((s: number, o: any) => s + Number(o.total_azn), 0),
        products: products.length,
        lowStock: products.filter((p: any) => p.stock < 5).length,
        pending: orders.filter((o: any) => o.status === "pending").length,
      });
      setRecentOrders(recentRes.data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Orders", value: stats.totalOrders, sub: `${stats.pending} pending`, color: "text-blue-400" },
          { label: "Total Revenue", value: `${stats.revenue.toFixed(2)} AZN`, sub: "Pay on delivery", color: "text-green-400" },
          { label: "Products", value: stats.products, sub: `${stats.lowStock} low stock`, color: "text-purple-400" },
          { label: "Low Stock", value: stats.lowStock, sub: "Below 5 units", color: "text-red-400" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">Recent Orders</h2>
          <Link href="/admin/orders" className="text-xs text-primary hover:underline">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-6 py-3 font-medium">Order ID</th>
                <th className="text-left px-6 py-3 font-medium">Customer</th>
                <th className="text-left px-6 py-3 font-medium">Status</th>
                <th className="text-right px-6 py-3 font-medium">Total</th>
                <th className="text-right px-6 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No orders yet</td></tr>
              ) : recentOrders.map((order: any) => (
                <tr key={order.id} className="border-b border-border/50 hover:bg-muted/30 transition">
                  <td className="px-6 py-3">
                    <Link href={`/admin/orders/${order.id}`} className="font-mono text-xs text-primary hover:underline">
                      #{String(order.id).slice(0, 8).toUpperCase()}
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    <div className="font-medium">{order.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{order.customer_phone}</div>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground"}`}>
                      {String(order.status).replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right font-medium">{Number(order.total_azn).toFixed(2)} AZN</td>
                  <td className="px-6 py-3 text-right text-muted-foreground text-xs">{new Date(order.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
