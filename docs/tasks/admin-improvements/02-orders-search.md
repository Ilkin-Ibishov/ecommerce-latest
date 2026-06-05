# Task 02 — Orders: Search by Customer Name / Phone

**Priority:** P0  
**Effort:** ~2h  
**File:** `artifacts/store/src/pages/admin/OrdersPage.tsx`

---

## Problem

The orders list has status filter tabs but no search input. With 5+ orders now and growing, admins need to find a specific order by customer phone number (the most common lookup) or name. Currently the only way is scrolling through all pages.

---

## Implementation Plan

### 1. Add search state + debounced query

```tsx
const [search, setSearch] = useState("");
const [debouncedSearch, setDebouncedSearch] = useState("");

// Debounce 300ms
useEffect(() => {
  const t = setTimeout(() => setDebouncedSearch(search), 300);
  return () => clearTimeout(t);
}, [search]);
```

### 2. Modify the Supabase query

```tsx
// In the useEffect load() function, after building the base query:
if (debouncedSearch.trim()) {
  const term = `%${debouncedSearch.trim()}%`;
  query = query.or(`customer_name.ilike.${term},customer_phone.ilike.${term}`);
}
```

> **Note:** Supabase PostgREST supports `ilike` for case-insensitive pattern matching on text columns. The `or` filter accepts multiple conditions.

### 3. Add the search input to the UI

Place above the status filter tabs:

```tsx
<div className="flex flex-col sm:flex-row gap-3">
  {/* Search input */}
  <div className="relative">
    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    <input
      type="text"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Search by name or phone…"
      className="pl-9 pr-4 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-64"
    />
    {search && (
      <button
        onClick={() => setSearch("")}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        <X size={14} />
      </button>
    )}
  </div>

  {/* Existing status filter tabs */}
  <div className="flex gap-2 flex-wrap">
    ...
  </div>
</div>
```

### 4. Reset page to 1 when search changes

```tsx
// In useEffect dependency array, add debouncedSearch
// When search changes, reset to page 1 by navigating
useEffect(() => {
  if (debouncedSearch) {
    // navigate to page 1 (keep status filter)
  }
}, [debouncedSearch]);
```

Or simpler: just use `debouncedSearch` as a dependency in the load useEffect and always query from offset 0 when it changes.

### 5. Show "X results for 'query'" when searching

```tsx
{debouncedSearch && (
  <p className="text-sm text-muted-foreground">
    {count} result{count !== 1 ? "s" : ""} for "{debouncedSearch}"
  </p>
)}
```

---

## Edge Cases

- **Phone number formats:** Users may enter `+994501234567`, `0501234567`, or `501234567`. The `ilike` with `%` prefix handles all of these since it matches substrings.
- **Empty search:** When search is cleared, restore normal paginated view.
- **Search + status filter combined:** Both filters should work together (AND logic — `query.eq("status", status).or(...)`).

---

## Files Changed
- `artifacts/store/src/pages/admin/OrdersPage.tsx` — search input + modified query
