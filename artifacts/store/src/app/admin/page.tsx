import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const [ordersRes, productsRes, recentOrdersRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, status, total_azn, created_at", { count: "exact" }),
    supabase
      .from("products")
      .select("id, stock, is_featured", { count: "exact" }),
    supabase
      .from("orders")
      .select(
        "id, status, total_azn, customer_name, customer_phone, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const orders = ordersRes.data ?? [];
  const products = productsRes.data ?? [];
  const recentOrders = recentOrdersRes.data ?? [];

  const totalRevenue = orders.reduce((sum, o) => sum + o.total_azn, 0);
  const pendingOrders = orders.filter((o) => o.status === "pending").length;
  const lowStockProducts = products.filter((p) => p.stock < 5).length;

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400",
    phone_verified: "bg-blue-500/20 text-blue-400",
    courier_assigned: "bg-purple-500/20 text-purple-400",
    shipped: "bg-indigo-500/20 text-indigo-400",
    delivered: "bg-green-500/20 text-green-400",
    refused_at_delivery: "bg-red-500/20 text-red-400",
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Orders",
            value: orders.length,
            sub: `${pendingOrders} pending`,
            color: "text-blue-400",
          },
          {
            label: "Total Revenue",
            value: `${totalRevenue.toFixed(2)} AZN`,
            sub: "Pay on delivery",
            color: "text-green-400",
          },
          {
            label: "Products",
            value: products.length,
            sub: `${lowStockProducts} low stock`,
            color: "text-purple-400",
          },
          {
            label: "Low Stock",
            value: lowStockProducts,
            sub: "Below 5 units",
            color: "text-red-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-card border border-border rounded-xl p-5"
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {stat.label}
            </p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>
              {stat.value}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Recent Orders */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold">Recent Orders</h2>
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
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No orders yet
                  </td>
                </tr>
              ) : (
                recentOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-border/50 hover:bg-muted/30 transition"
                  >
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground">
                      #{order.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-6 py-3">
                      <div className="font-medium">{order.customer_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {order.customer_phone}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          statusColors[order.status] ??
                          "bg-muted text-muted-foreground"
                        }`}
                      >
                        {order.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-medium">
                      {order.total_azn.toFixed(2)} AZN
                    </td>
                    <td className="px-6 py-3 text-right text-muted-foreground text-xs">
                      {new Date(order.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
