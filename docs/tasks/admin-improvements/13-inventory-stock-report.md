# Task 13 — Inventory / Stock Report Page

**Priority:** P2  
**Effort:** ~3h  
**New file:** `artifacts/store/src/pages/admin/InventoryPage.tsx`

---

## Problem

Stock is visible per-product in the products list, but there's no dedicated inventory view that:
- Shows all out-of-stock products at the top
- Lets the admin bulk-adjust stock for a shipment
- Shows total inventory value

---

## Implementation Plan

### 1. Data query

Direct Supabase read — no new API needed:

```typescript
const { data: products } = await (supabase as any)
  .from("products")
  .select("id, slug, stock, price, brand, product_translations!inner(lang_code, title), product_images(url)")
  .eq("product_translations.lang_code", "az")
  .order("stock", { ascending: true }); // out-of-stock first
```

### 2. Page layout

```tsx
export default function AdminInventoryPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <div className="flex gap-3 items-center text-sm text-muted-foreground">
          <span>{outOfStock} out of stock</span>
          <span>·</span>
          <span>{lowStock} low stock</span>
          <span>·</span>
          <span>Total value: {totalValue.toFixed(2)} AZN</span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Out of Stock" value={outOfStock} color="text-red-400" />
        <SummaryCard label="Low Stock (< 10)" value={lowStock} color="text-amber-400" />
        <SummaryCard label="Healthy Stock" value={healthyStock} color="text-green-400" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {["all", "out_of_stock", "low_stock", "healthy"].map((f) => (
          <button key={f} onClick={() => setFilter(f as Filter)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {f === "all" ? "All" : f === "out_of_stock" ? "Out of Stock" : f === "low_stock" ? "Low Stock" : "Healthy"}
          </button>
        ))}
      </div>

      {/* Product table with inline stock editing */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Product</th>
              <th className="text-left px-4 py-3 font-medium">Brand</th>
              <th className="text-right px-4 py-3 font-medium">Price</th>
              <th className="text-right px-4 py-3 font-medium">Stock</th>
              <th className="text-right px-4 py-3 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => (
              <tr key={p.id} className={`border-b border-border/50 hover:bg-muted/20 transition ${
                p.stock === 0 ? "bg-red-500/5" : p.stock < 5 ? "bg-orange-500/5" : ""
              }`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted overflow-hidden shrink-0">
                      {p.image ? <img src={p.image} alt="" className="object-cover w-full h-full" /> : <div className="w-full h-full bg-muted" />}
                    </div>
                    <Link href={`/admin/products/${p.id}/edit`} className="font-medium hover:text-primary line-clamp-1">
                      {p.title}
                    </Link>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{p.brand ?? "—"}</td>
                <td className="px-4 py-3 text-right">{Number(p.price).toFixed(2)} AZN</td>
                <td className="px-4 py-3 text-right">
                  {/* Reuse StockCell from Task 10 */}
                  <StockCell
                    productId={p.id}
                    initialStock={p.stock}
                    onSaved={(id, stock) => setProducts((prev) => prev.map((x) => x.id === id ? { ...x, stock } : x))}
                  />
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {(Number(p.price) * p.stock).toFixed(2)} AZN
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20">
              <td colSpan={4} className="px-4 py-3 font-semibold text-right">Total Inventory Value:</td>
              <td className="px-4 py-3 text-right font-bold text-primary">{totalValue.toFixed(2)} AZN</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
```

### 3. Computed values

```typescript
const outOfStock = products.filter((p) => p.stock === 0).length;
const lowStock = products.filter((p) => p.stock > 0 && p.stock < 10).length;
const healthyStock = products.filter((p) => p.stock >= 10).length;
const totalValue = products.reduce((sum, p) => sum + Number(p.price) * p.stock, 0);

type Filter = "all" | "out_of_stock" | "low_stock" | "healthy";
const [filter, setFilter] = useState<Filter>("all");

const filteredProducts = products.filter((p) => {
  if (filter === "out_of_stock") return p.stock === 0;
  if (filter === "low_stock") return p.stock > 0 && p.stock < 10;
  if (filter === "healthy") return p.stock >= 10;
  return true;
});
```

### 4. Add to AdminLayout nav + App.tsx

```tsx
// AdminLayout navItems — after Products:
{ href: "/admin/inventory", label: "Inventory", icon: Boxes },

// App.tsx:
<Route path="/admin/inventory" component={AdminInventoryPage} />
```

### 5. Dependency on Task 10

This page reuses the `StockCell` inline editing component from Task 10. Extract `StockCell` into a shared file:

```
artifacts/store/src/components/admin/StockCell.tsx
```

Both `ProductsPage` and `InventoryPage` import it from there.

---

## Files Changed
- `artifacts/store/src/pages/admin/InventoryPage.tsx` — new file
- `artifacts/store/src/components/admin/StockCell.tsx` — extracted from ProductsPage (Task 10)
- `artifacts/store/src/pages/admin/AdminLayout.tsx` — add Inventory nav item
- `artifacts/store/src/App.tsx` — register route
