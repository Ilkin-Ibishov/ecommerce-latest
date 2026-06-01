import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────
function startOf(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
}

function deltaClass(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct > 0) return "text-green-400";
  if (pct < 0) return "text-red-400";
  return "text-muted-foreground";
}

function DeltaIcon({ pct }: { pct: number | null }) {
  if (pct === null || pct === 0) return <Minus size={11} className="text-muted-foreground" />;
  return pct > 0
    ? <TrendingUp size={11} className="text-green-400" />
    : <TrendingDown size={11} className="text-red-400" />;
}

function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  if (!isFinite(pct)) return pct > 0 ? "+∞%" : "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function computeDelta(current: number, prev: number): number | null {
  if (prev === 0) return current === 0 ? null : null;
  return ((current - prev) / prev) * 100;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  phone_verified: "bg-blue-500/20 text-blue-400",
  courier_assigned: "bg-purple-500/20 text-purple-400",
  shipped: "bg-indigo-500/20 text-indigo-400",
  delivered: "bg-green-500/20 text-green-400",
  refused_at_delivery: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

const PIE_COLORS: Record<string, string> = {
  pending: "#eab308",
  phone_verified: "#3b82f6",
  courier_assigned: "#8b5cf6",
  shipped: "#6366f1",
  delivered: "#22c55e",
  refused_at_delivery: "#ef4444",
  cancelled: "#6b7280",
};

// ─── KPI Card ─────────────────────────────────────────────────
function KpiCard({
  label, value, sub, accent, pct,
}: {
  label: string; value: string | number; sub?: string; accent: string; pct: number | null;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <div className="flex items-center gap-1.5">
        <DeltaIcon pct={pct} />
        <span className={`text-xs font-medium ${deltaClass(pct)}`}>{formatPct(pct)}</span>
        <span className="text-xs text-muted-foreground">vs last month</span>
      </div>
      {sub && <p className="text-xs text-muted-foreground -mt-1">{sub}</p>}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

// ─── Custom Tooltip ───────────────────────────────────────────
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-bold text-primary">{Number(payload[0].value).toFixed(2)} AZN</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
interface DailyRevenue { date: string; revenue: number }
interface StatusBucket { name: string; value: number; color: string }
interface TopProduct { product_id: string; title: string; units: number; revenue: number; image: string | null }

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);

  // KPIs
  const [kpis, setKpis] = useState({
    revenueCurrent: 0, revenuePrev: 0,
    ordersCurrent: 0, ordersPrev: 0,
    aovCurrent: 0, aovPrev: 0,
    pendingCurrent: 0, pendingPrev: 0,
  });

  // Charts
  const [dailyRevenue, setDailyRevenue] = useState<DailyRevenue[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBucket[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const now = new Date();
      const thisMonthStart = startOf(now);
      const prevMonthStart = startOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [
        ordersThisRes,
        ordersPrevRes,
        recentRes,
        allOrdersStatusRes,
        last30Res,
      ] = await Promise.all([
        // Orders this month (id needed for items join, status/total for KPIs)
        (supabase as any)
          .from("orders")
          .select("id, status, total_azn, created_at")
          .gte("created_at", thisMonthStart),
        // Orders last month
        (supabase as any)
          .from("orders")
          .select("id, status, total_azn, created_at")
          .gte("created_at", prevMonthStart)
          .lt("created_at", thisMonthStart),
        // Recent orders (last 10)
        (supabase as any)
          .from("orders")
          .select("id, status, total_azn, customer_name, customer_phone, created_at")
          .order("created_at", { ascending: false })
          .limit(10),
        // All orders for status breakdown
        (supabase as any)
          .from("orders")
          .select("status"),
        // Orders last 30 days for daily revenue
        (supabase as any)
          .from("orders")
          .select("total_azn, created_at")
          .gte("created_at", thirtyDaysAgo)
          .order("created_at", { ascending: true }),
      ]);

      // ── Order items for this month: join through orders (order_items has no created_at) ──
      const thisOrderIds: string[] = (ordersThisRes.data ?? []).map((o: any) => o.id);
      const orderItemsThisRes = thisOrderIds.length > 0
        ? await (supabase as any)
            .from("order_items")
            .select("product_id, product_title_snapshot, line_total, quantity")
            .in("order_id", thisOrderIds)
        : { data: [] };

      // ── KPIs ──
      const thisOrders: any[] = ordersThisRes.data ?? [];
      const prevOrders: any[] = ordersPrevRes.data ?? [];

      const revCur = thisOrders.reduce((s, o) => s + Number(o.total_azn), 0);
      const revPrev = prevOrders.reduce((s, o) => s + Number(o.total_azn), 0);
      const ordCur = thisOrders.length;
      const ordPrev = prevOrders.length;
      const aovCur = ordCur > 0 ? revCur / ordCur : 0;
      const aovPrev = ordPrev > 0 ? revPrev / ordPrev : 0;
      const pendCur = thisOrders.filter((o) => o.status === "pending").length;
      const pendPrev = prevOrders.filter((o) => o.status === "pending").length;

      setKpis({ revenueCurrent: revCur, revenuePrev: revPrev, ordersCurrent: ordCur, ordersPrev: ordPrev, aovCurrent: aovCur, aovPrev: aovPrev, pendingCurrent: pendCur, pendingPrev: pendPrev });

      // ── Recent orders ──
      setRecentOrders(recentRes.data ?? []);

      // ── Daily revenue (last 30 days) ──
      const last30: any[] = last30Res.data ?? [];
      const byDate = new Map<string, number>();
      // Pre-fill every day in the range with 0
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
        byDate.set(key, 0);
      }
      for (const o of last30) {
        const d = new Date(o.created_at);
        const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
        byDate.set(key, (byDate.get(key) ?? 0) + Number(o.total_azn));
      }
      setDailyRevenue(Array.from(byDate.entries()).map(([date, revenue]) => ({ date, revenue })));

      // ── Top products this month ──
      const items: any[] = orderItemsThisRes.data ?? [];
      const productMap = new Map<string, { title: string; units: number; revenue: number }>();
      for (const item of items) {
        // Use product_id as key when available; fall back to title snapshot for deleted products
        const pid = item.product_id ?? `snapshot:${item.product_title_snapshot}`;
        const existing = productMap.get(pid);
        if (existing) {
          existing.units += item.quantity;
          existing.revenue += Number(item.line_total);
        } else {
          productMap.set(pid, {
            title: item.product_title_snapshot,
            units: item.quantity,
            revenue: Number(item.line_total),
          });
        }
      }
      const top5Raw = [...productMap.entries()]
        .map(([product_id, v]) => ({ product_id, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      // Fetch first image for each real product (snapshot keys are prefixed with "snapshot:")
      const realProductIds = top5Raw.map((p) => p.product_id).filter((id) => !id.startsWith("snapshot:"));
      let imageMap = new Map<string, string>();
      if (realProductIds.length > 0) {
        const { data: images } = await (supabase as any)
          .from("product_images")
          .select("product_id, url")
          .in("product_id", realProductIds)
          .order("sort_order", { ascending: true });
        if (images) {
          for (const img of images) {
            if (!imageMap.has(img.product_id)) imageMap.set(img.product_id, img.url);
          }
        }
      }

      setTopProducts(top5Raw.map((p) => ({ ...p, image: imageMap.get(p.product_id) ?? null })));

      // ── Status breakdown ──
      const allOrders: any[] = allOrdersStatusRes.data ?? [];
      const statusMap = new Map<string, number>();
      for (const o of allOrders) {
        statusMap.set(o.status, (statusMap.get(o.status) ?? 0) + 1);
      }
      const breakdown: StatusBucket[] = [];
      for (const [name, value] of statusMap.entries()) {
        breakdown.push({ name, value, color: PIE_COLORS[name] ?? "#9ca3af" });
      }
      breakdown.sort((a, b) => b.value - a.value);
      setStatusBreakdown(breakdown);

      setLoading(false);
    }

    load();
  }, []);

  // ── Revenue ticks: show every 5th label to avoid crowding ──
  const tickInterval = Math.max(1, Math.floor((dailyRevenue.length - 1) / 5));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <span className="text-xs text-muted-foreground">Analytics for current month vs previous</span>
      </div>

      {/* ── KPI Cards ── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Revenue (this month)"
            value={`${kpis.revenueCurrent.toFixed(2)} AZN`}
            accent="text-primary"
            pct={computeDelta(kpis.revenueCurrent, kpis.revenuePrev)}
          />
          <KpiCard
            label="Orders (this month)"
            value={kpis.ordersCurrent}
            sub={`${kpis.pendingCurrent} pending now`}
            accent="text-blue-400"
            pct={computeDelta(kpis.ordersCurrent, kpis.ordersPrev)}
          />
          <KpiCard
            label="Avg Order Value"
            value={`${kpis.aovCurrent.toFixed(2)} AZN`}
            accent="text-purple-400"
            pct={computeDelta(kpis.aovCurrent, kpis.aovPrev)}
          />
          <KpiCard
            label="Pending Orders"
            value={kpis.pendingCurrent}
            sub="Awaiting action"
            accent="text-yellow-400"
            pct={computeDelta(kpis.pendingCurrent, kpis.pendingPrev)}
          />
        </div>
      )}

      {/* ── Revenue Chart + Donut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Revenue line chart */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-4">Revenue — Last 30 Days</h2>
          {loading ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={dailyRevenue} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  interval={tickInterval}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v} ₼`}
                  width={52}
                />
                <Tooltip content={<RevenueTooltip />} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(47 100% 50%)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "hsl(47 100% 50%)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Orders by status donut */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-4">Orders by Status</h2>
          {loading ? (
            <Skeleton className="h-52 w-full" />
          ) : statusBreakdown.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No orders yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie
                  data={statusBreakdown}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {statusBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any) => [value, String(name).replace(/_/g, " ")]}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend
                  formatter={(value) => (
                    <span className="text-xs text-muted-foreground capitalize">
                      {String(value).replace(/_/g, " ")}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Top Products ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold">Top Products This Month</h2>
          <p className="text-xs text-muted-foreground mt-0.5">By revenue, based on orders placed this month</p>
        </div>
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : topProducts.length === 0 ? (
          <div className="px-6 py-8 text-center text-muted-foreground text-sm">No sales data this month</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-6 py-3 font-medium">#</th>
                  <th className="text-left px-6 py-3 font-medium">Product</th>
                  <th className="text-right px-6 py-3 font-medium">Units sold</th>
                  <th className="text-right px-6 py-3 font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, idx) => {
                  const isRealProduct = !p.product_id.startsWith("snapshot:");
                  return (
                    <tr key={p.product_id} className="border-b border-border/50 hover:bg-muted/30 transition">
                      <td className="px-6 py-3 text-muted-foreground font-mono text-xs">{idx + 1}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-muted shrink-0 overflow-hidden">
                            {p.image
                              ? <img src={p.image} alt={p.title} className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-muted-foreground/40 text-xs">?</div>
                            }
                          </div>
                          {isRealProduct ? (
                            <Link
                              href={`/admin/products/${p.product_id}/edit`}
                              className="font-medium hover:text-primary transition line-clamp-1"
                            >
                              {p.title}
                            </Link>
                          ) : (
                            <span className="font-medium line-clamp-1 text-muted-foreground">{p.title}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3 text-right text-muted-foreground">{p.units}</td>
                      <td className="px-6 py-3 text-right font-semibold text-primary">{p.revenue.toFixed(2)} AZN</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recent Orders ── */}
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
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-6 py-3"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-6 py-3"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-6 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    <td className="px-6 py-3 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-6 py-3 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : recentOrders.length === 0 ? (
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
