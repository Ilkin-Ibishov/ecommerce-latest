# Design Document

## Overview

This design addresses admin panel improvements across four phases: critical hotfixes (database migration, API redeployment, PWA icon, notifications endpoint), image proxy integration, shared reusable admin components, and page-level upgrades consuming those components.

The architecture prioritizes code reuse through shared components in `artifacts/store/src/components/admin/`, leverages the existing `getProxyUrl()` utility for image rendering, and implements a `search_text` generated column for efficient full-text search across products.

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Admin Panel)                                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ ProductsPage │  │InventoryPage │  │ AuditLogPage / etc.  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                  │                     │              │
│  ┌──────┴──────────────────┴─────────────────────┴───────────┐  │
│  │         Shared Components Layer                            │  │
│  │  SortableHeader · SearchInput · CategoryFilter             │  │
│  │  ConfirmDialog · CSVExportButton · PriceCell               │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                             │                                   │
│  ┌──────────────────────────┴────────────────────────────────┐  │
│  │  Data Layer: Supabase Client (direct) + adminFetch (API)  │  │
│  └──────────────────────────┬────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
    ┌─────────▼──────┐  ┌────▼────┐  ┌───────▼───────┐
    │  Supabase DB   │  │ wsrv.nl │  │  API Server   │
    │  (PostgreSQL)  │  │ (proxy) │  │  (Express 5)  │
    └────────────────┘  └─────────┘  └───────────────┘
```

### Data Flow

- **Products page**: Server-side sorting via Supabase `.order()`, full-text search via `ilike` on `search_text` column, URL-persisted state
- **Inventory page**: Client-side sorting (all ~152 products loaded in memory), client-side search/filter
- **Image rendering**: Raw URL → `getProxyUrl(url, "thumbnail")` → `<img src={proxied} onError={fallbackToRaw} />`
- **CSV export**: Client-side generation via `Blob` + `URL.createObjectURL` + anchor download

## Components and Interfaces

### Database: `search_text` Generated Column

A generated column on `products` that concatenates searchable fields for efficient `ilike` queries:

```sql
ALTER TABLE products
ADD COLUMN search_text text GENERATED ALWAYS AS (
  slug || ' ' || COALESCE(brand, '') || ' ' || COALESCE(
    (SELECT title FROM product_translations WHERE product_translations.product_id = products.id AND lang_code = 'az'),
    ''
  )
) STORED;

CREATE INDEX idx_products_search_text_trgm ON products USING gin (search_text gin_trgm_ops);
```

> Note: Supabase/PostgreSQL requires `pg_trgm` extension for the GIN trigram index. The `ilike('%term%')` query leverages this index for efficient substring matching.

### Shared UI Components

All located in `artifacts/store/src/components/admin/`:

#### SortableHeader

Pure presentational component. Receives sort state via props; no internal state.

```typescript
interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSort: string | null;
  currentDir: "asc" | "desc";
  onSort: (key: string, dir: "asc" | "desc") => void;
}

export function SortableHeader({ label, sortKey, currentSort, currentDir, onSort }: SortableHeaderProps) {
  const isActive = currentSort === sortKey;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";

  return (
    <th
      className="px-4 py-3 font-medium cursor-pointer hover:text-foreground transition select-none"
      onClick={() => onSort(sortKey, nextDir)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (currentDir === "asc" ? "↑" : "↓")}
      </span>
    </th>
  );
}
```

#### SearchInput

Controlled component with internal debounce timer. The parent provides value and receives debounced changes.

```typescript
interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number; // default 300
}

export function SearchInput({ placeholder, value, onChange, debounceMs = 300 }: SearchInputProps) {
  const [internal, setInternal] = useState(value);
  // Debounce: invoke onChange after debounceMs of inactivity
  useEffect(() => {
    const t = setTimeout(() => onChange(internal), debounceMs);
    return () => clearTimeout(t);
  }, [internal, debounceMs]);

  const clear = () => { setInternal(""); onChange(""); };

  return (
    <div className="relative">
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input type="text" value={internal} onChange={(e) => setInternal(e.target.value)}
        placeholder={placeholder} className="pl-8 pr-8 py-1.5 rounded-lg border ..." />
      {internal && <button onClick={clear} className="absolute right-2 ..."><X size={13} /></button>}
    </div>
  );
}
```

#### CategoryFilter

Fetches categories on mount from Supabase, renders a `<select>` dropdown.

```typescript
interface CategoryFilterProps {
  value: string | null;
  onFilter: (categoryId: string | null) => void;
}

export function CategoryFilter({ value, onFilter }: CategoryFilterProps) {
  const [categories, setCategories] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    const supabase = createClient();
    (supabase as any).from("categories")
      .select("id, category_translations(lang_code, title)")
      .then(({ data }: any) => {
        setCategories((data ?? []).map((c: any) => ({
          id: c.id,
          title: c.category_translations?.find((t: any) => t.lang_code === "az")?.title ?? c.id,
        })));
      });
  }, []);

  return (
    <select value={value ?? ""} onChange={(e) => onFilter(e.target.value || null)}
      className="px-3 py-1.5 rounded-lg border ...">
      <option value="">All categories</option>
      {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
    </select>
  );
}
```

#### ConfirmDialog

Uses React Portal to render a fixed overlay. State-driven: `{ open, title, message, onConfirm }`.

```typescript
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm",
  cancelLabel = "Cancel", destructive = false, onConfirm, onCancel }: ConfirmDialogProps) {
  // Focus trap: auto-focus confirm button on open
  // Escape key handler calls onCancel
  // Renders via createPortal to document.body as fixed overlay
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-sm text-muted-foreground mt-2">{message}</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg ...">{cancelLabel}</button>
          <button onClick={onConfirm}
            className={`px-4 py-2 rounded-lg font-medium ${destructive ? "bg-red-500 text-white" : "bg-primary text-primary-foreground"}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

Replaces `window.confirm()` in: `ProductsPage` (delete), `CategoriesPage` (delete), `CommentsPage` (delete), `ImageGrid` (delete).

#### CSVExportButton

Pure client-side CSV generation using `Blob` + `URL.createObjectURL`.

```typescript
interface CSVColumn<T> {
  key: keyof T | ((row: T) => string | number);
  header: string;
}

interface CSVExportButtonProps<T> {
  data: T[];
  columns: CSVColumn<T>[];
  filename: string; // e.g., "inventory-export"
}

export function CSVExportButton<T>({ data, columns, filename }: CSVExportButtonProps<T>) {
  const exportCSV = () => {
    const header = columns.map((c) => escapeCSV(c.header)).join(",");
    const rows = data.map((row) =>
      columns.map((col) => {
        const val = typeof col.key === "function" ? col.key(row) : row[col.key];
        return escapeCSV(String(val ?? ""));
      }).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button onClick={exportCSV} className="flex items-center gap-2 px-3 py-1.5 ...">
      <Download size={14} /> Export CSV
    </button>
  );
}

/** Escape a CSV cell value: wrap in quotes if contains comma, quote, or newline */
export function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

#### PriceCell

Mirrors the `StockCell` pattern exactly: click to edit, blur/Enter to save, Escape to cancel.

```typescript
interface PriceCellProps {
  productId: string;
  initialPrice: number;
  onSaved: (id: string, price: number) => void;
}

export function PriceCell({ productId, initialPrice, onSaved }: PriceCellProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(initialPrice));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const newPrice = parseFloat(value);
    if (isNaN(newPrice) || newPrice < 0 || newPrice === initialPrice) {
      setValue(String(initialPrice)); setEditing(false); return;
    }
    setSaving(true);
    await adminFetch(apiUrl(`/admin/products/${productId}`), {
      method: "PATCH",
      body: JSON.stringify({ price: newPrice }),
    });
    setSaving(false); setEditing(false);
    onSaved(productId, newPrice);
  };

  if (editing) {
    return (
      <input type="number" min={0} step="0.01" value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setValue(String(initialPrice)); setEditing(false); }
        }}
        className="w-20 px-2 py-1 rounded border ..." autoFocus />
    );
  }

  return (
    <button onClick={() => { setValue(String(initialPrice)); setEditing(true); }}
      title="Click to edit price"
      className="font-medium hover:underline cursor-text text-right w-full block">
      {saving ? "…" : `${initialPrice.toFixed(2)} AZN`}
    </button>
  );
}
```

### Image Proxy Integration

All admin image rendering uses the existing `getProxyUrl()` from `lib/image-proxy.ts`:

```typescript
import { getProxyUrl } from "@/lib/image-proxy";

// In any admin component rendering product images:
const proxyUrl = img ? getProxyUrl(img, "thumbnail") : null;

<img
  src={proxyUrl ?? undefined}
  alt={title}
  className="w-full h-full object-cover"
  onError={(e) => { (e.target as HTMLImageElement).src = img; }} // fallback to raw URL
/>
```

The `onError` fallback ensures that if the proxy fails, the raw URL is attempted (same pattern as storefront `ProductCard`).

To avoid double-proxying, the rendering code checks if the URL is already proxied:

```typescript
const isAlreadyProxied = img?.includes("wsrv.nl");
const src = img ? (isAlreadyProxied ? img : getProxyUrl(img, "thumbnail")) : null;
```

### Products Page Sorting (Server-Side)

Sort state persisted in URL params `?sort=price&dir=asc`:

```typescript
const sortField = params.get("sort") ?? "sort_order";
const sortDir = (params.get("dir") ?? "asc") as "asc" | "desc";

// Applied to Supabase query:
let query = supabase.from("products").select("...").order(sortField, { ascending: sortDir === "asc" });
```

### Inventory Page Sorting (Client-Side)

All data loaded in memory; sorting applied with `Array.sort()`:

```typescript
const sorted = [...filteredProducts].sort((a, b) => {
  const aVal = a[sortKey];
  const bVal = b[sortKey];
  const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal as string) : (aVal as number) - (bVal as number);
  return sortDir === "asc" ? cmp : -cmp;
});
```

### Bulk Price Update Modal

New modal with radio options for "Percentage discount" or "Set fixed price":

```typescript
interface BulkPriceState {
  open: boolean;
  mode: "percentage" | "fixed";
  value: string;
  progress: number; // 0..selectedIds.length
  processing: boolean;
}
```

Calls existing `PATCH /api/admin/products/:id` endpoint for each product sequentially, showing a progress bar:

```typescript
const handleBulkPrice = async () => {
  setState((s) => ({ ...s, processing: true, progress: 0 }));
  const ids = [...selected];
  for (let i = 0; i < ids.length; i++) {
    const product = products.find((p) => p.id === ids[i]);
    const newPrice = mode === "percentage"
      ? product.price * (1 - parseFloat(value) / 100)
      : parseFloat(value);
    await adminFetch(apiUrl(`/admin/products/${ids[i]}`), {
      method: "PATCH",
      body: JSON.stringify({ price: Math.max(0, newPrice) }),
    });
    setState((s) => ({ ...s, progress: i + 1 }));
  }
  // Refresh table
};
```

### Audit Log Filters

Two filters applied as AND condition via Supabase query modifiers:

```typescript
let query = supabase.from("audit_log").select("*").order("created_at", { ascending: false });

if (actionFilter) query = query.eq("action", actionFilter);
if (dateFrom) query = query.gte("created_at", dateFrom);
if (dateTo) query = query.lte("created_at", dateTo);
```

Action type dropdown populated from distinct values:

```typescript
const { data: actions } = await supabase.from("audit_log").select("action").then(({ data }) => ({
  data: [...new Set((data ?? []).map((r: any) => r.action))].sort()
}));
```

### Comments Bulk Approve

Adds checkbox per pending comment + "Approve All Selected" button:

```typescript
const [selectedComments, setSelectedComments] = useState<Set<string>>(new Set());

const handleBulkApprove = async () => {
  const ids = [...selectedComments];
  for (const id of ids) {
    await adminFetch(apiUrl(`/admin/comments/${id}`), {
      method: "PATCH",
      body: JSON.stringify({ approved: true }),
    });
  }
  setComments((prev) => prev.map((c) => selectedComments.has(c.id) ? { ...c, approved: true } : c));
  setSelectedComments(new Set());
};
```

### Interfaces

#### SortableHeader Props

| Prop | Type | Description |
|------|------|-------------|
| `label` | `string` | Column header display text |
| `sortKey` | `string` | Unique key identifying this column for sorting |
| `currentSort` | `string \| null` | Currently active sort key |
| `currentDir` | `"asc" \| "desc"` | Current sort direction |
| `onSort` | `(key: string, dir: "asc" \| "desc") => void` | Callback when header is clicked |

#### SearchInput Props

| Prop | Type | Description |
|------|------|-------------|
| `placeholder` | `string?` | Input placeholder text |
| `value` | `string` | Current search value |
| `onChange` | `(value: string) => void` | Debounced change callback |
| `debounceMs` | `number?` | Debounce delay (default: 300ms) |

#### CategoryFilter Props

| Prop | Type | Description |
|------|------|-------------|
| `value` | `string \| null` | Currently selected category ID |
| `onFilter` | `(categoryId: string \| null) => void` | Filter change callback |

#### ConfirmDialog Props

| Prop | Type | Description |
|------|------|-------------|
| `open` | `boolean` | Whether dialog is visible |
| `title` | `string` | Dialog title |
| `message` | `string` | Description text |
| `confirmLabel` | `string?` | Confirm button text (default: "Confirm") |
| `cancelLabel` | `string?` | Cancel button text (default: "Cancel") |
| `destructive` | `boolean?` | Red styling for confirm button |
| `onConfirm` | `() => void` | Called on confirm |
| `onCancel` | `() => void` | Called on cancel/escape |

#### CSVExportButton Props

| Prop | Type | Description |
|------|------|-------------|
| `data` | `T[]` | Current filtered dataset |
| `columns` | `CSVColumn<T>[]` | Column configuration |
| `filename` | `string` | Base filename (date appended) |

#### PriceCell Props

| Prop | Type | Description |
|------|------|-------------|
| `productId` | `string` | Product UUID |
| `initialPrice` | `number` | Current price value |
| `onSaved` | `(id: string, price: number) => void` | Callback after successful save |

#### Inventory CSV Columns

| Column Header | Source |
|---------------|--------|
| Product Name | `product_translations[az].title` |
| SKU | `products.sku` |
| Brand | `products.brand` |
| Category | `category_translations[az].title` |
| Price (AZN) | `products.price` |
| Stock | `products.stock` |
| Value (AZN) | `price × stock` |

## Data Models

### search_text Generated Column

```sql
-- Migration: add_search_text_column
ALTER TABLE products
ADD COLUMN search_text text GENERATED ALWAYS AS (
  slug || ' ' || COALESCE(brand, '') || ' ' || COALESCE(
    (SELECT title FROM product_translations
     WHERE product_translations.product_id = products.id AND lang_code = 'az'),
    ''
  )
) STORED;

-- Enable pg_trgm extension (if not already)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index for efficient ilike queries
CREATE INDEX idx_products_search_text_trgm ON products USING gin (search_text gin_trgm_ops);
```

### product_categories Table (migration fix)

```sql
-- Migration: ensure_product_categories
CREATE TABLE IF NOT EXISTS product_categories (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
```

### URL State Schema (Products Page)

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | `string` | `""` | Search query |
| `page` | `number` | `1` | Current page |
| `flag` | `FlagFilter` | `""` | Flag filter |
| `sort` | `string` | `"sort_order"` | Sort column |
| `dir` | `"asc" \| "desc"` | `"asc"` | Sort direction |
| `cat` | `string` | `""` | Category filter ID |

## Error Handling

### Image Proxy Fallback

```typescript
<img
  src={getProxyUrl(rawUrl, "thumbnail")}
  onError={(e) => { (e.target as HTMLImageElement).src = rawUrl; }}
/>
```

If `wsrv.nl` is unreachable or returns an error, the browser falls back to the raw image URL directly.

### ProductFormPage Error Banner

```typescript
if (error) {
  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
      <AlertTriangle className="text-red-400 shrink-0" />
      <div>
        <p className="font-medium text-red-400">Failed to load product data</p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </div>
      <button onClick={retry} className="ml-auto px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-sm">
        Retry
      </button>
    </div>
  );
}
```

### Bulk Operations Error Handling

For bulk price updates and bulk approve, errors are tracked per-item:

```typescript
const failures: { id: string; error: string }[] = [];
for (const id of ids) {
  try {
    await adminFetch(apiUrl(`/admin/products/${id}`), { ... });
  } catch (err) {
    failures.push({ id, error: (err as Error).message });
  }
}
if (failures.length > 0) {
  // Show toast: "X of Y updates failed"
}
```

### CSV Export Edge Cases

- Empty dataset: button disabled or shows toast "No data to export"
- Values with special characters: handled by `escapeCSV()` function wrapping in double-quotes

### PriceCell Validation

- `NaN`, negative, or unchanged values: revert to original, exit edit mode, no API call
- Network failure: catch error, revert to original price, show brief error indication

## Testing Strategy

### Property-Based Tests

Properties 1–11 above are suitable for property-based testing using `fast-check` (already in the project ecosystem). Each property test runs a minimum of 100 iterations with randomly generated inputs:

- **Pure function properties** (1, 2, 6, 7): Test `getProxyUrl()`, `escapeCSV()`, and PriceCell validation logic directly with generated URL strings, CSV cell values, and numeric inputs.
- **Sort/filter properties** (3, 8, 9, 10, 11): Generate random product arrays and sort/filter parameters to verify ordering invariants and filter correctness.
- **Debounce property** (4): Use timer mocks to verify that rapid input sequences produce exactly one debounced callback.
- **CSV structure property** (5): Generate random datasets and column configs, verify row/column counts match.

### Unit Tests (Example-Based)

- ConfirmDialog: open/close state, focus trap, Escape key handling, destructive styling
- ProductFormPage error banner: mock Supabase error, verify banner renders with retry button
- CategoryFilter: mock categories response, verify dropdown renders correct options
- Bulk price update: mock sequential API calls, verify progress tracking and error reporting
- Comments bulk approve: verify checkbox selection, bulk approve API calls, UI update

### Integration Tests

- `product_categories` migration idempotency
- API endpoints responding correctly after deployment
- Full-text search via `search_text` column returning expected results from Supabase

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Proxy URL Generation Produces Valid wsrv.nl URL

*For any* valid image URL string, calling `getProxyUrl(url, "thumbnail")` SHALL produce a URL that starts with the wsrv.nl base, contains the original URL as a `url` parameter, and includes the thumbnail preset dimensions (w=300, h=300).

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 2: Proxy URL Idempotence (No Double-Proxying)

*For any* URL that is already a wsrv.nl proxy URL (contains `wsrv.nl`), the admin rendering logic SHALL use it directly without wrapping it in another proxy call, ensuring the output URL contains exactly one `wsrv.nl` origin.

**Validates: Requirements 5.5**

### Property 3: Sort Direction Toggle

*For any* sort state consisting of a column key and direction, clicking the same column header SHALL toggle the direction (ascending → descending, descending → ascending), and clicking a different column SHALL reset to ascending.

**Validates: Requirements 7.2, 14.1, 14.2**

### Property 4: Debounce Emits Only Final Value

*For any* sequence of rapid input changes within the debounce window, the `SearchInput` component SHALL invoke the `onChange` callback exactly once with the final input value after the debounce delay has elapsed without further input.

**Validates: Requirements 8.2**

### Property 5: CSV Generation Correctness

*For any* non-empty array of data rows and a column configuration, the generated CSV SHALL contain exactly one header row matching the column headers and exactly N data rows where N equals the input array length, with each cell value corresponding to the correct column accessor applied to the source row.

**Validates: Requirements 11.2, 18.1**

### Property 6: CSV Escaping Round-Trip

*For any* string value containing commas, double-quotes, or newline characters, the `escapeCSV` function SHALL produce output that, when parsed by a standards-compliant CSV parser (RFC 4180), yields the original string value unchanged.

**Validates: Requirements 11.4**

### Property 7: PriceCell Rejects Invalid Prices

*For any* input value that is not a valid non-negative number (negative numbers, NaN, empty string, non-numeric text), the `PriceCell` component SHALL revert to the original price and exit edit mode without calling the PATCH endpoint.

**Validates: Requirements 12.4**

### Property 8: Full-Text Search Substring Matching

*For any* product with fields (title, slug, brand) and any search term that is a case-insensitive substring of at least one of those fields, the product SHALL appear in the search results. Conversely, for any search term that is NOT a substring of any of those fields, the product SHALL NOT appear in the results.

**Validates: Requirements 13.1, 13.2, 17.1**

### Property 9: Sorting Produces Correct Order

*For any* list of products and a sort key (name, price, stock, value), the sorted output SHALL satisfy the ordering invariant: for all consecutive pairs (a, b) in the result, `a[sortKey] <= b[sortKey]` when direction is ascending, or `a[sortKey] >= b[sortKey]` when direction is descending.

**Validates: Requirements 14.1, 17.2, 17.3**

### Property 10: Category Filter Correctness

*For any* selected category ID and product list, the filtered output SHALL contain only products that belong to the selected category, and SHALL contain ALL products from the input that belong to that category.

**Validates: Requirements 15.3, 17.5**

### Property 11: Audit Log Combined Filter

*For any* combination of action type filter and date range (from, to), the displayed audit log entries SHALL satisfy BOTH conditions simultaneously: every entry's action matches the selected type AND every entry's timestamp falls within [from, to] inclusive.

**Validates: Requirements 19.1, 19.2, 19.4**
