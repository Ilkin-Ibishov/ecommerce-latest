# Task 05 — Products: Pagination + Search/Filter

**Priority:** P1  
**Effort:** ~4h  
**File:** `artifacts/store/src/pages/admin/ProductsPage.tsx`

---

## Problem

`ProductsPage.tsx` currently fetches **all products** with no pagination or server-side filtering. With 152+ products this is already slow. At 500+ products it will be unusable and could hit Supabase row limits.

---

## Implementation Plan

### 1. Add URL-driven state (search + page)

Use `useSearch()` from wouter to keep state in the URL so browser back/forward works:

```typescript
const search = useSearch();
const params = new URLSearchParams(search);
const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
const searchQuery = params.get("q") ?? "";
const flagFilter = params.get("flag") ?? ""; // "featured" | "sale" | "deal"
const pageSize = 25;
const offset = (page - 1) * pageSize;
```

### 2. Server-side query with filters

Replace the existing `useEffect` query:

```typescript
async function load() {
  setLoading(true);
  let query = (supabase as any)
    .from("products")
    .select(
      "id, slug, price, stock, is_featured, is_on_sale, is_deal_of_day, brand, product_images(url), product_translations!inner(lang_code, title)",
      { count: "exact" }
    )
    .eq("product_translations.lang_code", "az")
    .order("sort_order")
    .range(offset, offset + pageSize - 1);

  // Search filter (title or slug)
  if (searchQuery.trim()) {
    const term = `%${searchQuery.trim()}%`;
    query = query.or(
      `slug.ilike.${term},product_translations.title.ilike.${term}`
    );
  }

  // Flag filter
  if (flagFilter === "featured") query = query.eq("is_featured", true);
  if (flagFilter === "sale") query = query.eq("is_on_sale", true);
  if (flagFilter === "deal") query = query.eq("is_deal_of_day", true);
  if (flagFilter === "low_stock") query = query.lt("stock", 10);
  if (flagFilter === "out_of_stock") query = query.eq("stock", 0);

  const { data, count } = await query;
  setProducts(data ?? []);
  setCount(count ?? 0);
  setLoading(false);
}
```

### 3. Search input UI

Add above the product table, next to the "New Product" button:

```tsx
<div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
  {/* Search */}
  <div className="relative flex-1 max-w-sm">
    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    <input
      type="text"
      defaultValue={searchQuery}
      onChange={(e) => {
        const val = e.target.value;
        const p = new URLSearchParams(search);
        if (val) p.set("q", val); else p.delete("q");
        p.delete("page");
        navigate(`/admin/products?${p.toString()}`);
      }}
      placeholder="Search products…"
      className="pl-9 pr-4 py-1.5 rounded-lg border border-border bg-background text-sm w-full focus:outline-none focus:ring-2 focus:ring-ring"
    />
  </div>

  {/* Flag filter dropdown */}
  <select
    value={flagFilter}
    onChange={(e) => {
      const p = new URLSearchParams(search);
      if (e.target.value) p.set("flag", e.target.value); else p.delete("flag");
      p.delete("page");
      navigate(`/admin/products?${p.toString()}`);
    }}
    className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none"
  >
    <option value="">All products</option>
    <option value="featured">Featured only</option>
    <option value="sale">On sale only</option>
    <option value="deal">Deal of day only</option>
    <option value="low_stock">Low stock ({"<"}10)</option>
    <option value="out_of_stock">Out of stock</option>
  </select>

  {/* Results count */}
  <span className="text-sm text-muted-foreground whitespace-nowrap">
    {count} product{count !== 1 ? "s" : ""}
  </span>
</div>
```

### 4. Pagination component

Reuse the same pagination pattern from OrdersPage:

```tsx
{Math.ceil(count / pageSize) > 1 && (
  <div className="flex items-center justify-center gap-1.5 pt-2">
    {page > 1 && (
      <Link
        href={`/admin/products?page=${page - 1}${searchQuery ? `&q=${searchQuery}` : ""}${flagFilter ? `&flag=${flagFilter}` : ""}`}
        className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-sm"
      >
        ← Prev
      </Link>
    )}
    <span className="text-sm text-muted-foreground">
      Page {page} of {Math.ceil(count / pageSize)}
    </span>
    {page < Math.ceil(count / pageSize) && (
      <Link
        href={`/admin/products?page=${page + 1}${searchQuery ? `&q=${searchQuery}` : ""}${flagFilter ? `&flag=${flagFilter}` : ""}`}
        className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-sm"
      >
        Next →
      </Link>
    )}
  </div>
)}
```

### 5. Table columns to add (while refactoring)

Take the opportunity to add a **Brand** column and improve the existing table since we're already touching it:

| Column | Status |
|--------|--------|
| # | Thumbnail + title | ✅ already exists |
| Slug | ✅ already exists |
| Brand | ➕ add |
| Price | ✅ already exists |
| Stock | ✅ already exists (red if < 5) |
| Flags | ✅ already exists |
| Actions | ✅ already exists |

---

## Performance Notes

- The `product_translations!inner` join with `eq("lang_code", "az")` ensures only one row per product is returned
- Use `{ count: "exact" }` for pagination total
- Supabase PostgREST handles server-side range efficiently

---

## Files Changed
- `artifacts/store/src/pages/admin/ProductsPage.tsx` — pagination, search, flag filter
