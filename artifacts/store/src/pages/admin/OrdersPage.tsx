import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { createClient } from "@/lib/supabase/client";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  phone_verified: "bg-blue-500/20 text-blue-400",
  courier_assigned: "bg-purple-500/20 text-purple-400",
  shipped: "bg-indigo-500/20 text-indigo-400",
  delivered: "bg-green-500/20 text-green-400",
  refused_at_delivery: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

const STATUSES = ["pending", "phone_verified", "courier_assigned", "shipped", "delivered", "refused_at_delivery", "cancelled"];

export default function AdminOrdersPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const status = params.get("status") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  const [orders, setOrders] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      setLoading(true);
      let query = (supabase as any)
        .from("orders")
        .select("id, status, total_azn, discount_azn, customer_name, customer_phone, delivery_address, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (status) query = query.eq("status", status);
      const { data, count: total } = await query;
      setOrders(data ?? []);
      setCount(total ?? 0);
      setLoading(false);
    }
    load();
  }, [status, page]);

  const totalPages = Math.ceil(count / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Orders</h1>
        <span className="text-sm text-muted-foreground">{count} total</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Link href="/admin/orders"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${!status ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/orders?status=${s}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${status === s ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
            {s.replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Order</th>
              <th className="text-left px-4 py-3 font-medium">Customer</th>
              <th className="text-left px-4 py-3 font-medium">Address</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-right px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Loading...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No orders found.</td></tr>
            ) : orders.map((o: any) => (
              <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20 transition">
                <td className="px-4 py-3">
                  <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs text-primary hover:underline">
                    #{String(o.id).slice(0, 8).toUpperCase()}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{o.customer_name}</div>
                  <div className="text-xs text-muted-foreground">{o.customer_phone}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs max-w-[160px] truncate">{o.delivery_address}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] ?? "bg-muted text-muted-foreground"}`}>
                    {String(o.status).replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium">{Number(o.total_azn).toFixed(2)} AZN</td>
                <td className="px-4 py-3 text-right text-muted-foreground text-xs">{new Date(o.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/admin/orders?page=${p}${status ? `&status=${status}` : ""}`}
              className={`w-8 h-8 flex items-center justify-center rounded text-sm transition ${p === page ? "bg-primary text-primary-foreground" : "bg-muted/50 hover:bg-muted text-muted-foreground"}`}>
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
