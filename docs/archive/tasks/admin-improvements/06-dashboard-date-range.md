# Task 06 — Dashboard: Date Range Selector

**Priority:** P1  
**Effort:** ~4h  
**File:** `artifacts/store/src/pages/admin/DashboardPage.tsx`

---

## Problem

All KPIs and the revenue chart are hardcoded to "this month vs last month". Admins cannot:
- Look at last 7 days when investigating a sudden drop
- Compare a custom promotional period to the previous one
- View a quarterly summary

---

## Implementation Plan

### 1. Define preset ranges

```typescript
type DatePreset = "7d" | "30d" | "thisMonth" | "lastMonth" | "90d" | "custom";

interface DateRange {
  from: Date;
  to: Date;
  compareFrom: Date;
  compareTo: Date;
  label: string;
}

function getDateRange(preset: DatePreset, customFrom?: Date, customTo?: Date): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  switch (preset) {
    case "7d": {
      const from = new Date(today.getTime() - 6 * 86400000);
      from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 7 * 86400000);
      const compareTo = new Date(from.getTime() - 1);
      return { from, to: today, compareFrom, compareTo, label: "Last 7 days" };
    }
    case "30d": {
      const from = new Date(today.getTime() - 29 * 86400000);
      from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 30 * 86400000);
      const compareTo = new Date(from.getTime() - 1);
      return { from, to: today, compareFrom, compareTo, label: "Last 30 days" };
    }
    case "thisMonth": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const compareFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const compareTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { from, to: today, compareFrom, compareTo, label: "This month" };
    }
    case "lastMonth": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      const compareFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const compareTo = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);
      return { from, to, compareFrom, compareTo, label: "Last month" };
    }
    case "90d": {
      const from = new Date(today.getTime() - 89 * 86400000);
      from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 90 * 86400000);
      const compareTo = new Date(from.getTime() - 1);
      return { from, to: today, compareFrom, compareTo, label: "Last 90 days" };
    }
    default:
      // custom — fallback to 30d if not provided
      return getDateRange("30d");
  }
}
```

### 2. Add state

```typescript
const [preset, setPreset] = useState<DatePreset>("thisMonth");
const [dateRange, setDateRange] = useState<DateRange>(() => getDateRange("thisMonth"));
```

### 3. Update all queries to use `dateRange.from` and `dateRange.to`

Replace hardcoded `thisMonthStart` / `prevMonthStart` with:
```typescript
const { from, to, compareFrom, compareTo } = dateRange;

// Main period
.gte("created_at", from.toISOString())
.lte("created_at", to.toISOString())

// Comparison period
.gte("created_at", compareFrom.toISOString())
.lte("created_at", compareTo.toISOString())
```

### 4. Update the revenue chart

The chart currently always shows last 30 days. When the range changes, regenerate the daily buckets using `from`/`to`:

```typescript
// Build date buckets between from and to
const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
const byDate = new Map<string, number>();
for (let i = 0; i < days; i++) {
  const d = new Date(from.getTime() + i * 86400000);
  const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  byDate.set(key, 0);
}
```

For ranges > 60 days, switch to weekly buckets to avoid crowded x-axis labels.

### 5. Preset picker UI

Place in the dashboard header row:

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold">Dashboard</h1>
  <div className="flex items-center gap-2">
    {(["7d", "30d", "thisMonth", "90d"] as DatePreset[]).map((p) => (
      <button
        key={p}
        onClick={() => { setPreset(p); setDateRange(getDateRange(p)); }}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
          preset === p
            ? "bg-primary text-primary-foreground"
            : "bg-muted/50 text-muted-foreground hover:bg-muted"
        }`}
      >
        {p === "7d" ? "7D" : p === "30d" ? "30D" : p === "thisMonth" ? "This Month" : "90D"}
      </button>
    ))}
    <span className="text-xs text-muted-foreground ml-1">
      vs {dateRange.compareFrom.toLocaleDateString()} – {dateRange.compareTo.toLocaleDateString()}
    </span>
  </div>
</div>
```

### 6. Re-trigger data load when range changes

Add `dateRange` to the `useEffect` dependency array. The load function already runs on mount; it will re-run on preset change.

```typescript
useEffect(() => {
  load();
}, [dateRange]);
```

---

## Deferred: Custom Date Picker

A full date picker (calendar UI) is out of scope for this task. The 4 presets (7D, 30D, This Month, 90D) cover 95% of use cases. Custom range can be added in a follow-up.

---

## Files Changed
- `artifacts/store/src/pages/admin/DashboardPage.tsx` — date range state, preset picker, parameterized queries
