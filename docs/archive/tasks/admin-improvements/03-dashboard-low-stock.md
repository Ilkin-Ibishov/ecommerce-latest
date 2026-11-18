# Task 03 — Dashboard: Low Stock Alert Panel

**Priority:** P1  
**Effort:** ~3h  
**File:** `artifacts/store/src/pages/admin/DashboardPage.tsx`

---

## Problem

Admins have no visibility into which products are running low on stock. Currently they must browse the products list and look for red numbers. A dashboard alert panel gives immediate actionable information.

---

## Implementation Plan

### 1. Add to the data loading in `DashboardPage`

Add a new query in the `Promise.all` block:

```typescript
const LOW_STOCK_THRESHOLD = 10;

const lowStockRes = await (supabase as any)
  .from("products")
  .select("id, slug, stock, product_translations!inner(lang_code, title), product_images(url)")
  .eq("product_translations.lang_code", "az")
  .lt("stock", LOW_STOCK_THRESHOLD)
  .order("stock", { ascending: true })
  .limit(10);
```

Add state:
```typescript
const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([]);

interface LowStockProduct {
  id: string;
  slug: string;
  stock: number;
  title: string;
  image: string | null;
}
```

### 2. Add the panel component

Place it after the KPI cards, before the revenue chart:

```tsx
{/* Low Stock Alert */}
{!loading && lowStockProducts.length > 0 && (
  <div className="bg-card border border-amber-500/30 rounded-xl overflow-hidden">
    <div className="px-5 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
      <AlertTriangle size={15} className="text-amber-500" />
      <h2 className="font-semibold text-sm text-amber-600">
        Low Stock Alert — {lowStockProducts.length} product{lowStockProducts.length !== 1 ? "s" : ""} running low
      </h2>
      <Link href="/admin/products" className="ml-auto text-xs text-amber-600 hover:underline">
        View all products →
      </Link>
    </div>
    <div className="divide-y divide-border">
      {lowStockProducts.map((p) => (
        <div key={p.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/20 transition">
          <div className="w-8 h-8 rounded-lg bg-muted overflow-hidden shrink-0">
            {p.image
              ? <img src={p.image} alt={p.title} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-muted" />}
          </div>
          <span className="flex-1 text-sm truncate">{p.title}</span>
          <Link
            href={`/admin/products/${p.id}/edit`}
            className="text-xs text-primary hover:underline shrink-0"
          >
            Edit
          </Link>
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
```

### 3. Color thresholds

| Stock | Color | Label |
|-------|-------|-------|
| 0 | Red | "OUT" |
| 1–4 | Orange | "{n} left" |
| 5–9 | Amber | "{n} left" |

### 4. Make threshold configurable (optional enhancement)

Add a constant at the top of the file:
```typescript
const LOW_STOCK_THRESHOLD = 10; // products with stock < this appear in the alert
```

Later this can be pulled from a settings table (Task 16).

---

## Files Changed
- `artifacts/store/src/pages/admin/DashboardPage.tsx` — new query + panel component
