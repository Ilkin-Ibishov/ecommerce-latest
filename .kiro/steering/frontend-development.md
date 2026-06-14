---
inclusion: fileMatch
fileMatchPattern: "**/store/**"
---

# Frontend (Store) Development Guide

## Structure

```
artifacts/store/src/
├── App.tsx                    # Root: providers, router
├── main.tsx                   # Entry point
├── index.css                  # Tailwind imports
├── components/
│   ├── ui/                    # shadcn/ui primitives (Button, Dialog, etc.)
│   ├── storefront/            # Customer-facing components (Header, Footer, ProductCard)
│   └── auth/                  # Auth-related components
├── pages/
│   ├── storefront/            # Customer pages (HomePage, ProductsPage, etc.)
│   └── admin/                 # Admin pages (DashboardPage, ProductsPage, etc.)
├── lib/
│   ├── api.ts                 # apiUrl() helper
│   ├── utils.ts               # cn() utility + getTranslatedField(translations, locale, field, fallback)
│   ├── admin-fetch.ts         # Admin API fetch wrapper
│   ├── user-fetch.ts          # userFetch()/getAuthHeader() — authed non-admin fetch
│   ├── env.ts                 # resolveSupabaseEnv() (mirrors api-server lib/env.ts)
│   ├── cart/context.tsx        # Cart React context
│   ├── i18n/context.tsx        # I18n React context (t typed as MessageKey | (string & {}))
│   ├── i18n/messages/          # Per-locale modules: az.ts, ru.ts, en.ts + schema.ts + index.ts (getT)
│   ├── queries/               # Centralized Supabase reads (getProducts/getCategoriesTree/getOrders + select fragments)
│   ├── supabase/              # Supabase browser client (typed SupabaseClient<Database>)
│   └── hooks/                 # useAdminList, useConfirm, useProfile, ...
└── hooks/                     # Additional hooks (use-mobile, use-toast)

Shared admin building blocks live in `components/admin/`: `useAdminList` (hook in `lib/hooks/`) +
`DataTable` / `Pagination` / `TableEmptyState`, plus `ConfirmDialog` (+ `useConfirm`), `SearchInput`,
`SortableHeader`, `CategoryFilter`, `StockCell`, `PriceCell`, `CSVExportButton`, `BulkBar`, `BulkPriceModal`.
Storefront shared blocks: `ProductGrid`, `SortDropdown`, `ProductCard`, `ProductSkeletonGrid`.
```

## Adding a New Page

### Storefront Page
1. Create `artifacts/store/src/pages/storefront/{PageName}.tsx`
2. Component receives `locale` prop: `function MyPage({ locale }: { locale: string })`
3. Add route in `App.tsx` inside `StorefrontRoutes`:
   ```tsx
   <Route path={`/${locale}/my-path`}>{() => <MyPage locale={locale} />}</Route>
   ```

### Admin Page
1. Create `artifacts/store/src/pages/admin/{PageName}.tsx`
2. Add route in `App.tsx` inside `AdminRoutes`:
   ```tsx
   <Route path="/admin/my-path" component={MyPage} />
   ```

## Adding a New UI Component

Use the shadcn/ui pattern:
1. Create in `artifacts/store/src/components/ui/{component}.tsx`
2. Use Radix UI primitive as base
3. Style with Tailwind + CVA for variants
4. Export from the file directly (no barrel exports)

## Data Fetching

```tsx
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

// GET request
const { data, isLoading } = useQuery({
  queryKey: ["products", locale],
  queryFn: () => fetch(apiUrl(`/products?lang=${locale}`)).then(r => r.json()),
});

// POST/PUT/DELETE
const mutation = useMutation({
  mutationFn: (body) => fetch(apiUrl("/products"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json()),
});
```

## i18n Usage

```tsx
import { useI18n } from "@/lib/i18n/context";

function MyComponent() {
  const { t, locale } = useI18n();
  return <h1>{t("page.title")}</h1>;
}
```

All user-facing strings MUST use `t()`. Translations live in per-locale modules `artifacts/store/src/lib/i18n/messages/{az,ru,en}.ts` (NOT the old single `messages.ts`). Add new keys to ALL THREE locale files (the `i18n-consistency` test enforces identical key structure). `t()` accepts `MessageKey | (string & {})` so known keys get autocomplete while dynamic keys still compile.

## Admin list pages (useAdminList + shared table)

Admin list pages should use the `useAdminList` hook + shared components rather than hand-rolling load/count/loading/debounce/pagination:

```tsx
import { useAdminList } from "@/lib/hooks/useAdminList";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { SearchInput } from "@/components/admin/SearchInput";
import { getOrders } from "@/lib/queries/orders";

const { rows, count, loading, page, totalPages, search, searchInput, setSearchInput } =
  useAdminList({ fetcher: (a) => getOrders(createClient(), a), basePath: "/admin/orders", pageSize: 30 });
// <SearchInput value={searchInput} onChange={setSearchInput} debounceMs={0} />  (hook owns the 350ms debounce)
// <DataTable columns={cols} rows={rows} loading={loading} empty={<TableEmptyState .../>} getRowKey={r=>r.id} />
// <Pagination page={page} totalPages={totalPages} buildHref={...} />
```

OrdersPage/UsersPage/AuditPage use this. Pages with heavy local state (Products/Inventory bulk-select + inline edits, Comments/Coupons CRUD/card views, Wishlist) intentionally keep their own structure but still adopt the shared pieces where clean. Centralize Supabase reads in `lib/queries/`. Confirm destructive actions with `useConfirm()` + `<ConfirmDialog>`. Pick localized fields with `getTranslatedField()` from `@/lib/utils`.

## Cart Context

```tsx
import { useCart } from "@/lib/cart/context";

function MyComponent() {
  const { items, subtotal, itemCount, addItem, removeItem, updateQty, getItemQty, clearCart } = useCart();
  
  // Check if product is in cart
  const cartQty = getItemQty(product.id);
  const isInCart = cartQty > 0;
  
  // Use updateQty for existing items (sets exact value)
  // Use addItem for new items (additive)
  if (isInCart) updateQty(product.id, newQty);
  else addItem({ product_id, slug, title, price, image }, qty);
}
```

Cart validates localStorage on load — rejects items with negative prices, quantities > 99, or missing required fields.

## Form Validation Pattern

For checkout and other forms, use client-side validation with inline error messages:

```tsx
const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

// Validate before submit
const errors: Record<string, string> = {};
if (!value.trim()) errors.fieldName = t("Checkout.fieldRequired");
if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }

// Clear errors on input change
onChange={(v) => { setValue(v); setFieldErrors(e => ({ ...e, fieldName: "" })); }}

// Display inline error
{error && <p className="text-destructive text-xs mt-1">{error}</p>}
```

## Styling

- Use Tailwind utility classes directly
- Use `cn()` from `@/lib/utils` for conditional classes
- Mobile-first responsive design (`md:`, `lg:` breakpoints)
- Dark mode not currently implemented

## Testing

### Unit Tests (vitest)

Run: `pnpm exec vitest --run --project store-unit`

Vitest unit/property test files live in `artifacts/store/src/__tests__/*.test.ts` (consolidated here — the config `include` is `src/**/*.test.ts`). Shared fixtures/helpers live in `artifacts/store/tests/helpers/`. Playwright component tests are `tests/components/*.spec.tsx` (run via `test:ct`); E2E is `tests/e2e/*.spec.ts`. Use `@/` imports (resolved via vitest alias).

Key test files:
- `i18n-hardcoded-strings.test.ts` — All 15 components have translation keys
- `i18n-preservation.test.ts` — Existing keys unchanged after modifications
- `i18n-consistency.test.ts` — All locales have identical key structure, no empty strings
- `cart-validation.test.ts` — Cart localStorage tampering prevention (property tests)

### E2E Tests (Playwright)

Run: `pnpm --filter @workspace/store run test:e2e`

Config: `artifacts/store/playwright.config.ts`
Tests in: `artifacts/store/tests/e2e/*.spec.ts`

Set `BASE_URL` env var to test against deployed URL instead of localhost.

### Accessibility

All icon-only buttons must have `aria-label`. All interactive elements need `focus-visible:ring-1 focus-visible:ring-ring`. Use the `Button` component from `ui/button.tsx` when possible — it has focus styles built in. For raw `<button>` elements, add focus styles manually.
