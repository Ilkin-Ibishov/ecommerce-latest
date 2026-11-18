# Task 14 — Dashboard: Revenue by Category Chart

**Priority:** P3  
**Effort:** ~4h  
**File:** `artifacts/store/src/pages/admin/DashboardPage.tsx`

---

## Problem

Admins can see top 5 products but not which product categories drive the most revenue. This insight is key for merchandising decisions (which categories to expand, where to focus marketing).

---

## Implementation Plan

### 1. The data challenge

Products are linked to categories via `product_categories` (a join table). `order_items` doesn't have a category — it only has `product_id`. To get revenue by category, we need to:

1. Get all `order_items` for the date range (already fetched via `thisOrderIds`)
2. Join to `product_categories` to get `category_id`
3. Join to `category_translations` to get the category name
4. Aggregate revenue per category

This requires multiple queries since PostgREST doesn't do arbitrary JOINs easily.

### 2. Query strategy

```typescript
// Step 1: Already have order items from this month (from main load)
// orderItemsThisRes.data contains product_id and line_total

// Step 2: Get all product → category mappings for the products in orders
const productIds = [...new Set((orderItemsThisRes.data ?? []).map((i: any) => i.product_id))];

let revenueByCategory: RevenueByCat[] = [];
if (productIds.length > 0) {
  const { data: productCats } = await (supabase as any)
    .from("product_categories")
    .select("product_id, categories(id, category_translations(lang_code, title))")
    .in("product_id", productIds);

  // Build product → category map
  const prodToCat = new Map<string, { id: string; title: string }>();
  (productCats ?? []).forEach((pc: any) => {
    const title = pc.categories?.category_translations
      ?.find((t: any) => t.lang_code === "az")?.title ?? "Other";
    prodToCat.set(pc.product_id, { id: pc.categories.id, title });
  });

  // Aggregate revenue by category
  const catRevMap = new Map<string, { title: string; revenue: number }>();
  (orderItemsThisRes.data ?? []).forEach((item: any) => {
    const cat = prodToCat.get(item.product_id);
    const catKey = cat?.id ?? "uncategorized";
    const catTitle = cat?.title ?? "Uncategorized";
    const existing = catRevMap.get(catKey);
    if (existing) {
      existing.revenue += Number(item.line_total);
    } else {
      catRevMap.set(catKey, { title: catTitle, revenue: Number(item.line_total) });
    }
  });

  revenueByCategory = [...catRevMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
}
```

### 3. Add a horizontal bar chart

Use Recharts `BarChart` in horizontal layout:

```tsx
interface RevenueByCat { title: string; revenue: number }
const [revenueByCategory, setRevenueByCategory] = useState<RevenueByCat[]>([]);
```

```tsx
{/* Revenue by Category */}
<div className="bg-card border border-border rounded-xl p-5">
  <h2 className="font-semibold mb-4">Revenue by Category (This Month)</h2>
  {loading ? (
    <Skeleton className="h-52 w-full" />
  ) : revenueByCategory.length === 0 ? (
    <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
      No sales data this month
    </div>
  ) : (
    <ResponsiveContainer width="100%" height={Math.max(180, revenueByCategory.length * 36)}>
      <BarChart
        data={revenueByCategory}
        layout="vertical"
        margin={{ top: 0, right: 60, bottom: 0, left: 0 }}
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
          width={120}
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
            formatter: (v: number) => `${v.toFixed(0)} ₼`,
            fontSize: 10,
            fill: "hsl(var(--muted-foreground))",
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  )}
</div>
```

### 4. Placement in the dashboard

Add this chart as a full-width section below the existing revenue chart + donut row:

```
[Revenue line chart (2/3)] [Status donut (1/3)]
[Revenue by category — full width]
[Top products table — full width]
[Recent orders — full width]
```

### 5. Performance consideration

This adds 1 additional Supabase query (`product_categories` join). It's a small read on a relatively small table. No caching needed for admin dashboards.

---

## Files Changed
- `artifacts/store/src/pages/admin/DashboardPage.tsx` — new query, new state, horizontal bar chart section
