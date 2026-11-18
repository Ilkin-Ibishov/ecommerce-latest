# Task 04 — Dashboard: Missing KPIs

**Priority:** P1  
**Effort:** ~3h  
**File:** `artifacts/store/src/pages/admin/DashboardPage.tsx`

---

## Problem

The current 4-KPI row (Revenue, Orders, AOV, Pending) is missing key operational metrics that matter daily:
- **New customers this month** — growth signal
- **Cancellation rate** — operational health
- **Coupon usage** — marketing effectiveness

---

## Implementation Plan

### New KPIs to Add

Expand from 4 KPI cards to 7, in a `grid-cols-2 sm:grid-cols-4 lg:grid-cols-7` or wrap to second row.

**Recommended layout:** Keep existing 4 in row 1, add 3 in row 2 (or just expand to 7 columns on large screens).

---

### KPI 5: New Customers This Month

**Data:** Count of `users` rows created this month vs last month.

```typescript
const [
  customersThisRes,
  customersPrevRes,
] = await Promise.all([
  (supabase as any)
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", thisMonthStart),
  (supabase as any)
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", prevMonthStart)
    .lt("created_at", thisMonthStart),
]);

const customersCurrent = customersThisRes.count ?? 0;
const customersPrev = customersPrevRes.count ?? 0;
```

**Card:**
```tsx
<KpiCard
  label="New Customers"
  value={kpis.customersCurrent}
  accent="text-cyan-400"
  pct={computeDelta(kpis.customersCurrent, kpis.customersPrev)}
/>
```

---

### KPI 6: Cancellation Rate This Month

**Data:** Already fetched — `ordersThisRes.data` contains all orders with status. Compute:

```typescript
const cancelledCur = thisOrders.filter((o) => o.status === "cancelled").length;
const cancelRateCur = ordCur > 0 ? (cancelledCur / ordCur) * 100 : 0;

const cancelledPrev = prevOrders.filter((o) => o.status === "cancelled").length;
const cancelRatePrev = ordPrev > 0 ? (cancelledPrev / ordPrev) * 100 : 0;
```

**Card:** Show as percentage (e.g. "4.2%"). Delta logic inverted — a lower rate is better, so red means it went up.

```tsx
<KpiCard
  label="Cancellation Rate"
  value={`${cancelRateCur.toFixed(1)}%`}
  sub={`${cancelledCur} cancelled`}
  accent={cancelRateCur > 10 ? "text-red-400" : "text-green-400"}
  pct={computeDelta(cancelRatePrev, cancelRateCur)} // inverted: prev/cur swapped
/>
```

---

### KPI 7: Active Coupon Usage This Month

**Data:** Count of `coupon_usages` rows this month.

```typescript
const couponUsageRes = await (supabase as any)
  .from("coupon_usages")
  .select("id", { count: "exact", head: true })
  .gte("used_at", thisMonthStart);

const couponUsageCurrent = couponUsageRes.count ?? 0;
```

**Card:**
```tsx
<KpiCard
  label="Coupons Used"
  value={couponUsageCurrent}
  sub="This month"
  accent="text-pink-400"
  pct={null} // no prev-month comparison needed here
/>
```

---

### Updated KPI State Shape

```typescript
const [kpis, setKpis] = useState({
  // existing
  revenueCurrent: 0, revenuePrev: 0,
  ordersCurrent: 0, ordersPrev: 0,
  aovCurrent: 0, aovPrev: 0,
  pendingCurrent: 0, pendingPrev: 0,
  // new
  customersCurrent: 0, customersPrev: 0,
  cancelRateCurrent: 0, cancelRatePrev: 0,
  couponUsageCurrent: 0,
});
```

---

### Layout

The 7 KPIs should be in two rows on smaller screens:

```tsx
{/* Row 1 — 4 existing KPIs */}
<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
  <KpiCard label="Revenue" ... />
  <KpiCard label="Orders" ... />
  <KpiCard label="Avg Order Value" ... />
  <KpiCard label="Pending Orders" ... />
</div>

{/* Row 2 — 3 new KPIs */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
  <KpiCard label="New Customers" ... />
  <KpiCard label="Cancellation Rate" ... />
  <KpiCard label="Coupons Used" ... />
</div>
```

---

## Files Changed
- `artifacts/store/src/pages/admin/DashboardPage.tsx` — new queries + 3 KPI cards
