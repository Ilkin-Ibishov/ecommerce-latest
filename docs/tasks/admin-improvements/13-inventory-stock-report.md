# Task 13 — Inventory / Stock Report Page

**Priority:** P2  
**Effort:** ~3h  
**New file:** `artifacts/store/src/pages/admin/InventoryPage.tsx`

---

## Verified Findings (from source analysis)

⚠️ **`StockCell` is currently inlined inside `ProductsPage.tsx`** — it is not a shared component yet. This task must extract it first before using it in `InventoryPage`. Failing to do so creates duplication.

The `product_translations!inner` join syntax (used in the original plan) **requires verification** — the storefront `ProductsPage` does NOT use `!inner` and instead filters translations post-fetch. For safety, use the same pattern as existing code: select `product_translations(lang_code, title)` and pick the AZ title in JS.

**`PATCH /admin/products/:id/stock`** endpoint exists (added in Task 10). `StockCell` calls it directly.

**Data volume:** 152 products total — loading all at once for an inventory report is acceptable (no pagination needed).

**Nav ordering in `AdminLayout.tsx`:** Current order is Dashboard → Products → Orders → Coupons → Banners → Categories → Comments → Audit Log. Inventory should go after Products (position 2).

---

## Implementation

### Step 1 — Extract `StockCell` to shared component

Create `artifacts/store/src/components/admin/StockCell.tsx`:

```typescript
import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

export function StockCell({ productId, initialStock, onSaved }: {
  productId: string;
  initialStock: number;
  onSaved: (id: string, stock: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(initialStock));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const newStock = parseInt(value, 10);
    if (isNaN(newStock) || newStock < 0 || newStock === initialStock) {
      setValue(String(initialStock)); setEditing(false); return;
    }
    setSaving(true);
    await adminFetch(apiUrl(`/admin/products/${productId}/stock`), {
      method: "PATCH",
      body: JSON.stringify({ stock: newStock }),
    });
    setSaving(false); setEditing(false);
    onSaved(productId, newStock);
  };

  if (editing) {
    return (
      <input type="number" min={0} value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setValue(String(initialStock)); setEditing(false); } }}
        className="w-16 px-2 py-1 rounded border border-primary bg-background text-sm text-right focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <button onClick={() => { setValue(String(initialStock)); setEditing(true); }}
      title="Click to edit stock"
      className={`font-medium hover:underline cursor-text text-right w-full block ${
        initialStock === 0 ? "text-red-400" : initialStock < 5 ? "text-orange-400" : ""
      }`}
    >
      {saving ? "…" : initialStock}
    </button>
  );
}
```

Update `ProductsPage.tsx` to import from the new shared file:
```typescript
import { StockCell } from "@/components/admin/StockCell";
// Remove the inline StockCell function definition
```

### Step 2 — `InventoryPage.tsx`

**Data fetch** (uses same pattern as existing code — no `!inner`):
```typescript
const { data } = await (supabase as any)
  .from("products")
  .select("id, slug, price, stock, brand, product_translations(lang_code, title), product_images(url, sort_order)")
  .order("stock", { ascending: true }); // out-of-stock first

// Post-process translations
const products = (data ?? []).map((p: any) => ({
  ...p,
  title: (p.product_translations as any[])?.find((t: any) => t.lang_code === "az")?.title
    ?? (p.product_translations as any[])?.[0]?.title ?? "Unknown",
  image: [...(p.product_images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order)[0]?.url ?? null,
}));
```

**Computed values** (derived from state, not separate queries):
```typescript
const outOfStock = products.filter((p) => p.stock === 0).length;
const lowStock = products.filter((p) => p.stock > 0 && p.stock < 10).length;
const healthyStock = products.filter((p) => p.stock >= 10).length;
const totalValue = products.reduce((sum, p) => sum + Number(p.price) * p.stock, 0);
```

**Client-side filter** (all data loaded, filter in JS):
```typescript
type Filter = "all" | "out_of_stock" | "low_stock" | "healthy";
const filteredProducts = products.filter((p) => {
  if (filter === "out_of_stock") return p.stock === 0;
  if (filter === "low_stock") return p.stock > 0 && p.stock < 10;
  if (filter === "healthy") return p.stock >= 10;
  return true;
});
```

**Layout:**
- Header with title + stat summary (`{outOfStock} out · {lowStock} low · value: {totalValue} AZN`)
- 3 summary cards (Out of Stock red, Low Stock amber, Healthy green)
- Filter tabs: All | Out of Stock | Low Stock | Healthy
- Table: image + name (→ edit link), Brand, Price, Stock (`StockCell`), Value (price × stock)
- `<tfoot>` row: Total Inventory Value right-aligned

**Row background tinting:**
```typescript
className={`... ${p.stock === 0 ? "bg-red-500/5" : p.stock < 5 ? "bg-orange-500/5" : ""}`}
```

### Step 3 — `AdminLayout.tsx`

Add after Products nav item (index 1):
```typescript
import { Boxes } from "lucide-react";
// navItems after Package/Products:
{ href: "/admin/inventory", label: "Inventory", icon: Boxes },
```

### Step 4 — `App.tsx`

```typescript
import AdminInventoryPage from "@/pages/admin/InventoryPage";
// Inside AdminRoutes, after /admin/products routes:
<Route path="/admin/inventory" component={AdminInventoryPage} />
```

---

## Dependencies
- Must run **after or alongside Task 10** (StockCell extraction) — can't be done independently
- No backend changes needed — uses existing `PATCH /admin/products/:id/stock`
- No DB migrations needed

---

## Files Changed
- `artifacts/store/src/components/admin/StockCell.tsx` — new shared component (extracted from ProductsPage)
- `artifacts/store/src/pages/admin/ProductsPage.tsx` — remove inline StockCell, import from shared
- `artifacts/store/src/pages/admin/InventoryPage.tsx` — new file
- `artifacts/store/src/pages/admin/AdminLayout.tsx` — add Inventory nav item
- `artifacts/store/src/App.tsx` — register route
