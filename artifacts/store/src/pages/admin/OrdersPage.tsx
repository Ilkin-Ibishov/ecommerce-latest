import { useEffect, useState, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Search, X, Download } from "lucide-react";
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

const STATUSES = ["pending", "phone_verified", "courier_assigned", "shipped", "delivered", "refused_at_delivery", "cancelled"];

export default function AdminOrdersPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const status = params.get("status") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  // Local search input state — debounced before being used in the query
  const [searchInput, setSearchInput] = useState(params.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(params.get("q") ?? "");

  const [orders, setOrders] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Debounce: wait 350ms after user stops typing before running the query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Sync the URL when debounced search changes
  useEffect(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set("q", debouncedSearch);
    if (status) p.set("status", status);
    // Always reset to page 1 on new search
    const qs = p.toString();
    navigate(`/admin/orders${qs ? `?${qs}` : ""}`, { replace: true });
  }, [debouncedSearch]);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    let query = (supabase as any)
      .from("orders")
      .select("id, status, total_azn, discount_azn, customer_name, customer_phone, delivery_address, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (status) query = query.eq("status", status);

    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      query = query.or(`customer_name.ilike.${term},customer_phone.ilike.${term}`);
    }

    const { data, count: total } = await query;
    setOrders(data ?? []);
    setCount(total ?? 0);
    setLoading(false);
  }, [status, page, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(count / pageSize);

  const buildHref = (p: number, s?: string, q?: string) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (s) ps.set("status", s);
    if (q) ps.set("q", q);
    const qs = ps.toString();
    return `/admin/orders${qs ? `?${qs}` : ""}`;
  };

  const clearSearch = () => { setSearchInput(""); setDebouncedSearch(""); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Orders</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {debouncedSearch ? `${count} result${count !== 1 ? "s" : ""} for "${debouncedSearch}"` : `${count} total`}
          </span>
          <button
            onClick={async () => {
              const ps = new URLSearchParams();
              if (status) ps.set("status", status);
              const res = await adminFetch(`${apiUrl("/admin/orders/export")}?${ps.toString()}`);
              if (!res.ok) return;
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition"
          >
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {/* Search + status filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search input */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or phone…"
            className="pl-8 pr-8 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-56"
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Status tabs */}
        <div className="flex gap-2 flex-wrap">
          <Link
            href={buildHref(1, "", debouncedSearch)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${!status ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
          >
            All
          </Link>
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={buildHref(1, s, debouncedSearch)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${status === s ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
            >
              {s.replace(/_/g, " ")}
            </Link>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
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
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  {debouncedSearch ? `No orders found for "${debouncedSearch}"` : "No orders found."}
                </td></tr>
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
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={buildHref(p, status, debouncedSearch)}
              className={`w-8 h-8 flex items-center justify-center rounded text-sm transition ${p === page ? "bg-primary text-primary-foreground" : "bg-muted/50 hover:bg-muted text-muted-foreground"}`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
