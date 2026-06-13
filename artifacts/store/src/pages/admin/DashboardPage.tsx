import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getProxyUrl } from "@/lib/image-proxy";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ─── Date range presets ───────────────────────────────────────
type DatePreset = "7d" | "30d" | "thisMonth" | "90d";

interface DateRange {
  from: Date;
  to: Date;
  compareFrom: Date;
  compareTo: Date;
  label: string;
}

function getDateRange(preset: DatePreset): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  switch (preset) {
    case "7d": {
      const from = new Date(today.getTime() - 6 * 86400000); from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 7 * 86400000);
      return { from, to: today, compareFrom, compareTo: new Date(from.getTime() - 1), label: "Last 7 days" };
    }
    case "30d": {
      const from = new Date(today.getTime() - 29 * 86400000); from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 30 * 86400000);
      return { from, to: today, compareFrom, compareTo: new Date(from.getTime() - 1), label: "Last 30 days" };
    }
    case "90d": {
      const from = new Date(today.getTime() - 89 * 86400000); from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 90 * 86400000);
      return { from, to: today, compareFrom, compareTo: new Date(from.getTime() - 1), label: "Last 90 days" };
    }
    case "thisMonth":
    default: {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const compareFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const compareTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { from, to: today, compareFrom, compareTo, label: "This month" };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────
function deltaClass(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct > 0) return "text-green-400";
  if (pct < 0) return "text-red-400";
  return "text-muted-foreground";
}

function DeltaIcon({ pct, inverted = false }: { pct: number | null; inverted?: boolean }) {
  if (pct === null || pct === 0) return <Minus size={11} className="text-muted-foreground" />;
  const isGood = inverted ? pct < 0 : pct > 0;
  return isGood
    ? <TrendingUp size={11} className="text-green-400" />
    : <TrendingDown size={11} className="text-red-400" />;
}

function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  if (!isFinite(pct)) return pct > 0 ? "+∞%" : "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function computeDelta(current: number, prev: number): number | null {
  if (prev === 0) return null;
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

const LOW_STOCK_THRESHOLD = 10;

// ─── Sub-components ───────────────────────────────────────────
function KpiCard({
  label, value, sub, accent, pct, invertDelta = false,
}: {
  label: string; value: string | number; sub?: string; accent: string; pct: number | null; invertDelta?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <div className="flex items-center gap-1.5">
        <DeltaIcon pct={pct} inverted={invertDelta} />
        <span className={`text-xs font-medium ${invertDelta && pct !== null ? (pct < 0 ? "text-green-400" : pct > 0 ? "text-red-400" : "text-muted-foreground") : deltaClass(pct)}`}>
          {formatPct(pct)}
        </span>
        <span className="text-xs text-muted-foreground">vs prior period</span>
      </div>
      {sub && <p className="text-xs text-muted-foreground -mt-1">{sub}</p>}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-bold text-primary">{Number(payload[0].value).toFixed(2)} AZN</p>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────
interface DailyRevenue { date: string; revenue: number }
interface StatusBucket { name: string; value: number; color: string }
interface TopProduct { product_id: string; title: string; units: number; revenue: number; image: string | null }
interface LowStockProduct { id: string; stock: number; title: string; image: string | null }
interface RevenueByCat { title: string; revenue: number }

// ─── Main Page ────────────────────────────────────────────────
export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<DatePreset>("thisMonth");
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRange("thisMonth"));

  // KPIs
  const [kpis, setKpis] = useState({
    revenueCurrent: 0, revenuePrev: 0,
    ordersCurrent: 0, ordersPrev: 0,
    aovCurrent: 0, aovPrev: 0,
    pendingCurrent: 0, pendingPrev: 0,
    customersCurrent: 0, customersPrev: 0,
    cancelRateCurrent: 0, cancelRatePrev: 0,
    couponUsageCurrent: 0,
  });

  // Charts & lists
  const [dailyRevenue, setDailyRevenue] = useState<DailyRevenue[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBucket[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([]);
  const [revenueByCategory, setRevenueByCategory] = useState<RevenueByCat[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { from, to, compareFrom, compareTo } = dateRange;
    const fromISO = from.toISOString();
    const toISO = to.toISOString();
    const compareFromISO = compareFrom.toISOString();
    const compareToISO = compareTo.toISOString();

    const [
      ordersThisRes,
      ordersPrevRes,
      recentRes,
      allOrdersStatusRes,
      rangeOrdersRes,
      customersThisRes,
      customersPrevRes,
      couponUsageRes,
      lowStockRes,
    ] = await Promise.all([
      // Orders in selected range
      (supabase as any).from("orders").select("id, status, total_azn, created_at")
        .gte("created_at", fromISO).lte("created_at", toISO),
      // Orders in comparison range
      (supabase as any).from("orders").select("id, status, total_azn, created_at")
        .gte("created_at", compareFromISO).lte("created_at", compareToISO),
      // Recent orders (last 10 — always latest regardless of range)
      (supabase as any).from("orders")
        .select("id, status, total_azn, customer_name, customer_phone, created_at")
        .order("created_at", { ascending: false }).limit(10),
      // All orders for status breakdown (all-time)
      (supabase as any).from("orders").select("status"),
      // Orders in range for daily chart
      (supabase as any).from("orders").select("total_azn, created_at")
        .gte("created_at", fromISO).lte("created_at", toISO)
        .order("created_at", { ascending: true }),
      // New customers in range
      (supabase as any).from("users").select("id", { count: "exact", head: true })
        .gte("created_at", fromISO).lte("created_at", toISO),
      // New customers in comparison range
      (supabase as any).from("users").select("id", { count: "exact", head: true })
        .gte("created_at", compareFromISO).lte("created_at", compareToISO),
      // Coupon usages in range
      (supabase as any).from("coupon_usages").select("id", { count: "exact", head: true })
        .gte("used_at", fromISO).lte("used_at", toISO),
      // Low stock products
      (supabase as any).from("products")
        .select("id, stock, product_translations(lang_code, title), product_images(url, sort_order)")
        .lt("stock", LOW_STOCK_THRESHOLD).order("stock", { ascending: true }).limit(10),
    ]);

    // ── Order items for selected range ──
    const thisOrderIds: string[] = (ordersThisRes.data ?? []).map((o: any) => o.id);
    const orderItemsThisRes = thisOrderIds.length > 0
      ? await (supabase as any).from("order_items")
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

    const cancelledCur = thisOrders.filter((o) => o.status === "cancelled").length;
    const cancelledPrev = prevOrders.filter((o) => o.status === "cancelled").length;
    const cancelRateCur = ordCur > 0 ? (cancelledCur / ordCur) * 100 : 0;
    const cancelRatePrev = ordPrev > 0 ? (cancelledPrev / ordPrev) * 100 : 0;

    const customersCur = customersThisRes.count ?? 0;
    const customersPrev = customersPrevRes.count ?? 0;
    const couponUsageCur = couponUsageRes.count ?? 0;

    setKpis({
      revenueCurrent: revCur, revenuePrev: revPrev,
      ordersCurrent: ordCur, ordersPrev: ordPrev,
      aovCurrent: aovCur, aovPrev: aovPrev,
      pendingCurrent: pendCur, pendingPrev: pendPrev,
      customersCurrent: customersCur, customersPrev: customersPrev,
      cancelRateCurrent: cancelRateCur, cancelRatePrev: cancelRatePrev,
      couponUsageCurrent: couponUsageCur,
    });

    setRecentOrders(recentRes.data ?? []);

    // ── Daily revenue chart (bucket by day across selected range) ──
    const rangeOrders: any[] = rangeOrdersRes.data ?? [];
    const totalDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    const byDate = new Map<string, number>();
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(from.getTime() + i * 86400000);
      const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      byDate.set(key, 0);
    }
    for (const o of rangeOrders) {
      const d = new Date(o.created_at);
      const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      byDate.set(key, (byDate.get(key) ?? 0) + Number(o.total_azn));
    }
    setDailyRevenue(Array.from(byDate.entries()).map(([date, revenue]) => ({ date, revenue })));

    // ── Top products ──
    const items: any[] = orderItemsThisRes.data ?? [];
    const productMap = new Map<string, { title: string; units: number; revenue: number }>();
    for (const item of items) {
      const pid = item.product_id ?? `snapshot:${item.product_title_snapshot}`;
      const existing = productMap.get(pid);
      if (existing) { existing.units += item.quantity; existing.revenue += Number(item.line_total); }
      else { productMap.set(pid, { title: item.product_title_snapshot, units: item.quantity, revenue: Number(item.line_total) }); }
    }
    const top5Raw = [...productMap.entries()].map(([product_id, v]) => ({ product_id, ...v }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const realProductIds = top5Raw.map((p) => p.product_id).filter((id) => !id.startsWith("snapshot:"));
    const imageMap = new Map<string, string>();
    if (realProductIds.length > 0) {
      const { data: images } = await (supabase as any).from("product_images")
        .select("product_id, url").in("product_id", realProductIds).order("sort_order", { ascending: true });
      (images ?? []).forEach((img: any) => { if (!imageMap.has(img.product_id)) imageMap.set(img.product_id, img.url); });
    }
    setTopProducts(top5Raw.map((p) => ({ ...p, image: imageMap.get(p.product_id) ?? null })));

    // ── Revenue by category (uses product_specs __category rows) ──
    const productIdsInOrders = [...new Set(items.map((i: any) => i.product_id).filter(Boolean))];
    if (productIdsInOrders.length > 0) {
      const { data: catSpecs } = await (supabase as any)
        .from("product_specs")
        .select("product_id, spec_value")
        .eq("spec_key", "__category")
        .in("product_id", productIdsInOrders);

      if (catSpecs && catSpecs.length > 0) {
        const catIds = [...new Set((catSpecs as any[]).map((s: any) => s.spec_value))];
        const { data: catTranslations } = await (supabase as any)
          .from("category_translations")
          .select("category_id, title")
          .eq("lang_code", "az")
          .in("category_id", catIds);

        const catTitleMap = new Map<string, string>(
          (catTranslations ?? []).map((t: any) => [t.category_id, t.title])
        );
        const prodToCat = new Map<string, string>();
        (catSpecs as any[]).forEach((s: any) => prodToCat.set(s.product_id, s.spec_value));

        const catRevMap = new Map<string, { title: string; revenue: number }>();
        items.forEach((item: any) => {
          const catId = prodToCat.get(item.product_id);
          if (!catId) return;
          const title = catTitleMap.get(catId) ?? "Other";
          const existing = catRevMap.get(catId);
          if (existing) { existing.revenue += Number(item.line_total); }
          else { catRevMap.set(catId, { title, revenue: Number(item.line_total) }); }
        });

        setRevenueByCategory(
          [...catRevMap.values()]
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 8)
        );
      } else {
        setRevenueByCategory([]);
      }
    } else {
      setRevenueByCategory([]);
    }

    // ── Status breakdown (all-time) ──
    const allOrders: any[] = allOrdersStatusRes.data ?? [];
    const statusMap = new Map<string, number>();
    for (const o of allOrders) statusMap.set(o.status, (statusMap.get(o.status) ?? 0) + 1);
    const breakdown: StatusBucket[] = [...statusMap.entries()]
      .map(([name, value]) => ({ name, value, color: PIE_COLORS[name] ?? "#9ca3af" }))
      .sort((a, b) => b.value - a.value);
    setStatusBreakdown(breakdown);

    // ── Low stock ──
    const lowStockData = (lowStockRes.data ?? []).map((p: any) => {
      const title = (p.product_translations as any[])?.find((t: any) => t.lang_code === "az")?.title
        ?? (p.product_translations as any[])?.[0]?.title ?? "Unknown";
      const sortedImgs = [...(p.product_images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
      return { id: p.id, stock: p.stock, title, image: sortedImgs[0]?.url ?? null };
    });
    setLowStockProducts(lowStockData);

    setLoading(false);
  }, [dateRange]);

  useEffect(() => { load(); }, [load]);

  const changePreset = (p: DatePreset) => { setPreset(p); setDateRange(getDateRange(p)); };
  const tickInterval = Math.max(1, Math.floor((dailyRevenue.length - 1) / 5));

  return (
    <div className="space-y-8">
      {/* ── Header with date range selector ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["7d", "30d", "thisMonth", "90d"] as DatePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => changePreset(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                preset === p ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {p === "7d" ? "7D" : p === "30d" ? "30D" : p === "thisMonth" ? "This Month" : "90D"}
            </button>
          ))}
          <span className="text-xs text-muted-foreground ml-1 hidden sm:inline">
            {dateRange.label}
          </span>
        </div>
      </div>

      {/* ── Row 1 KPIs ── */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-32" /><Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Revenue" value={`${kpis.revenueCurrent.toFixed(2)} AZN`} accent="text-primary" pct={computeDelta(kpis.revenueCurrent, kpis.revenuePrev)} />
          <KpiCard label="Orders" value={kpis.ordersCurrent} sub={`${kpis.pendingCurrent} pending`} accent="text-blue-400" pct={computeDelta(kpis.ordersCurrent, kpis.ordersPrev)} />
          <KpiCard label="Avg Order Value" value={`${kpis.aovCurrent.toFixed(2)} AZN`} accent="text-purple-400" pct={computeDelta(kpis.aovCurrent, kpis.aovPrev)} />
          <KpiCard label="Pending Orders" value={kpis.pendingCurrent} sub="Awaiting action" accent="text-yellow-400" pct={computeDelta(kpis.pendingCurrent, kpis.pendingPrev)} />
        </div>
      )}

      {/* ── Row 2 KPIs ── */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard label="New Customers" value={kpis.customersCurrent} accent="text-cyan-400" pct={computeDelta(kpis.customersCurrent, kpis.customersPrev)} />
          <KpiCard
            label="Cancellation Rate"
            value={`${kpis.cancelRateCurrent.toFixed(1)}%`}
            sub={`${Math.round((kpis.cancelRateCurrent / 100) * kpis.ordersCurrent)} cancelled`}
            accent={kpis.cancelRateCurrent > 10 ? "text-red-400" : "text-green-400"}
            pct={computeDelta(kpis.cancelRateCurrent, kpis.cancelRatePrev)}
            invertDelta
          />
          <KpiCard label="Coupons Used" value={kpis.couponUsageCurrent} sub="In selected period" accent="text-pink-400" pct={null} />
        </div>
      )}

      {/* ── Low Stock Alert ── */}
      {!loading && lowStockProducts.length > 0 && (
        <div className="bg-card border border-amber-500/30 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500 shrink-0" />
            <h2 className="font-semibold text-sm text-amber-600">
              Low Stock Alert — {lowStockProducts.length} product{lowStockProducts.length !== 1 ? "s" : ""} running low
            </h2>
            <Link href="/admin/products" className="ml-auto text-xs text-amber-600 hover:underline shrink-0">
              Manage →
            </Link>
          </div>
          <div className="divide-y divide-border">
            {lowStockProducts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/20 transition">
                <div className="w-8 h-8 rounded-lg bg-muted overflow-hidden shrink-0">
                  {p.image ? <img src={getProxyUrl(p.image, "thumbnail")} alt={p.title} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = p.image!; }} /> : <div className="w-full h-full bg-muted" />}
                </div>
                <span className="flex-1 text-sm truncate">{p.title}</span>
                <Link href={`/admin/products/${p.id}/edit`} className="text-xs text-primary hover:underline shrink-0">Edit</Link>
                <span className={`text-sm font-bold shrink-0 w-16 text-right ${
                  p.stock === 0 ? "text-red-500" : p.stock < 5 ? "text-orange-500" : "text-amber-500"
                }`}>
                  {p.stock === 0 ? "OUT" : `${p.stock} left`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Revenue Chart + Donut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-4">Revenue — {dateRange.label}</h2>
          {loading ? <Skeleton className="h-52 w-full" /> : (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={dailyRevenue} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={tickInterval} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v} ₼`} width={52} />
                <Tooltip content={<RevenueTooltip />} />
                <Line type="monotone" dataKey="revenue" stroke="hsl(47 100% 50%)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "hsl(47 100% 50%)" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-4">Orders by Status (All Time)</h2>
          {loading ? <Skeleton className="h-52 w-full" /> : statusBreakdown.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No orders yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie data={statusBreakdown} cx="50%" cy="45%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                  {statusBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(value: any, name: any) => [value, String(name).replace(/_/g, " ")]} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                <Legend formatter={(value) => <span className="text-xs text-muted-foreground capitalize">{String(value).replace(/_/g, " ")}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Revenue by Category ── */}
      {!loading && revenueByCategory.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-4">Revenue by Category — {dateRange.label}</h2>
          <ResponsiveContainer width="100%" height={Math.max(160, revenueByCategory.length * 38)}>
            <BarChart
              data={revenueByCategory}
              layout="vertical"
              margin={{ top: 0, right: 64, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `${v} ₼`}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="title"
                tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
                tickLine={false}
                axisLine={false}
                width={130}
              />
              <Tooltip
                formatter={(v: any) => [`${Number(v).toFixed(2)} AZN`, "Revenue"]}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar
                dataKey="revenue"
                fill="hsl(47 100% 50%)"
                radius={[0, 4, 4, 0]}
                label={{
                  position: "right",
                  formatter: (v: number) => `${Number(v).toFixed(0)} ₼`,
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Top Products ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold">Top Products — {dateRange.label}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">By revenue, from orders placed in selected period</p>
        </div>
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg shrink-0" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : topProducts.length === 0 ? (
          <div className="px-6 py-8 text-center text-muted-foreground text-sm">No sales data in this period</div>
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
                  const isReal = !p.product_id.startsWith("snapshot:");
                  return (
                    <tr key={p.product_id} className="border-b border-border/50 hover:bg-muted/30 transition">
                      <td className="px-6 py-3 text-muted-foreground font-mono text-xs">{idx + 1}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-muted shrink-0 overflow-hidden">
                            {p.image ? <img src={getProxyUrl(p.image, "thumbnail")} alt={p.title} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = p.image!; }} /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground/40 text-xs">?</div>}
                          </div>
                          {isReal ? (
                            <Link href={`/admin/products/${p.product_id}/edit`} className="font-medium hover:text-primary transition line-clamp-1">{p.title}</Link>
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
          <table className="w-full min-w-[560px] text-sm">
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
