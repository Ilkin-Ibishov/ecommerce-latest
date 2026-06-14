# Architecture Refactoring Backlog

> Generated from a full architecture audit (frontend, backend, cross-cutting) of the white-label e-commerce monorepo.
> Prioritized by risk-adjusted value. None are emergencies — this is accumulated copy-paste / type-safety debt.

## Top finding: shared packages exist but aren't adopted

The monorepo already has `@workspace/db` (Drizzle schema + types), `@workspace/api-zod` (generated Zod schemas + types from the OpenAPI spec), and `@workspace/api-client-react` (typed React client). They are imported in **exactly one file** (`health.ts`). Everywhere else, both packages access Supabase data through `(supabase as any)` / `(req: any)` / `.map((x: any) => ...)`. Adopting these existing packages is the highest-leverage fix.

---

## HIGH IMPACT

### H1 — The `as any` epidemic (type safety)
**Severity:** HIGH
**Scope:** Both packages (store + api-server)
Domain types (Product, Order, Category, CartItem, User) are effectively untyped. `(supabase as any)`, `(req: any)`, `.map((p: any) => ...)` appear across most storefront pages, admin pages, and API routes. Only `health.ts` imports the generated shared types.
**Fix:** Adopt `SupabaseClient<Database>` + existing generated types from `@workspace/db` / `@workspace/api-zod`. Replace `as any` Supabase access incrementally, file by file. Single source of truth tied to `supabase/schema.sql`.
**Files:** `artifacts/api-server/src/lib/supabase.ts`, `routes/admin.ts`, `routes/orders.ts`, `routes/products.ts`; `artifacts/store/src/pages/**`.

### H2 — `requireAdmin` / user-auth duplicated ~55 times
**Severity:** HIGH
`requireAdmin(req)` is re-called inline in ~40+ admin handlers; user-token auth boilerplate repeats in ~15 more (orders/cart/wishlist/comments/profile). `middlewares/` is empty except `.gitkeep`.
**Fix:** Extract real Express middleware: `requireAdmin`, `requireUser`. Attach `req.admin` / `req.user` context.
**Files:** `artifacts/api-server/src/middlewares/` (new), `routes/admin.ts`, `routes/pages.ts`, `routes/product-images.ts`, `routes/site-settings.ts`, `routes/orders.ts`, `routes/cart.ts`, `routes/wishlist.ts`, `routes/comments.ts`, `routes/profile.ts`.

### H3 — Tested pure functions exist but are NEVER used (correctness bug)
**Severity:** HIGH
`lib/coupon-calc.ts` (`calculateDiscount`) and `lib/cart-merge.ts` (`mergeGuestCart`) are fully tested but never imported. `orders.ts`, `coupons.ts`, and `cart.ts` re-implement the logic inline with **divergent behavior** (orders.ts skips `Math.round`; cart paths miss the `MAX_QUANTITY` cap).
**Fix:** Wire in the existing tested functions everywhere coupon math / cart merge happens. Lowest-risk, highest-value fix.
**Files:** `artifacts/api-server/src/routes/orders.ts`, `routes/coupons.ts`, `routes/cart.ts`, `lib/coupon-calc.ts`, `lib/cart-merge.ts`.

### H4 — Admin "list page" pattern duplicated across 7+ pages
**Severity:** HIGH
Every admin list page (Products, Orders, Users, Inventory, Coupons, Comments, Audit) re-implements load/count/loading state, URL-driven pagination, and debounced search by hand. Pagination JSX in `ProductsPage` and `UsersPage` is byte-identical. `OrdersPage`/`UsersPage` re-type the internals of the existing `SearchInput` component instead of using it.
**Fix:** Extract `useAdminList()` hook + `<DataTable>` / `<Pagination>` / `<TableEmptyState>` components. Replace bespoke search blocks with existing `SearchInput`.
**Files:** `artifacts/store/src/pages/admin/{ProductsPage,OrdersPage,UsersPage,InventoryPage,CouponsPage,CommentsPage,AuditPage}.tsx`, `components/admin/` (new shared).

### H5 — Raw Supabase queries scattered instead of a data layer
**Severity:** HIGH
The same product select (`product_images + product_translations + product_categories`) is rebuilt in 4 places; the category-tree query is duplicated verbatim between admin and storefront. Mixed access styles (direct Supabase vs REST API) across pages.
**Fix:** Centralize into `lib/queries/` with reusable select fragments and typed wrappers (`getProducts()`, `getCategoriesTree()`, `getOrders()`).
**Files:** `artifacts/store/src/lib/queries/` (new); callers in `pages/admin/*` and `pages/storefront/*`.

### H6 — `getTitle` translation-picker reimplemented ~20 times
**Severity:** HIGH (volume), low risk
`translations.find(t => t.lang_code === locale)?.title ?? translations[0]?.title ?? "Untitled"` appears in ~20 call sites (some hardcode `"az"`, some use `locale` field).
**Fix:** One `getTranslatedField(translations, locale, field, fallback)` util in `lib/utils.ts` (handle both `lang_code` and `locale` key shapes).
**Files:** `artifacts/store/src/lib/utils.ts` (new helper); ~20 callers.

### H7 — `admin.ts` is 648 lines spanning 8 domains
**Severity:** HIGH (maintainability)
**Fix:** Split into `routes/admin/*` by domain (products, coupons, banners, inventory, audit, etc.), aggregated by an `admin/index.ts`.
**Files:** `artifacts/api-server/src/routes/admin.ts` → `routes/admin/`.

---

## MEDIUM IMPACT

### M1 — No central error handler
`app.ts` has no error middleware despite Express 5 auto-forwarding async errors; ~60 handlers carry identical try/catch+500 boilerplate. `search.ts` / `categories.ts` have no try/catch *and* leak `err.message` to clients.
**Fix:** Add a central `errorHandler` middleware (Express 5 auto-forwards). Remove redundant try/catch where the handler just returns 500. Stop leaking `err.message`.
**Files:** `artifacts/api-server/src/app.ts`, `middlewares/errorHandler.ts` (new), all routes.

### M2 — Zod referenced in steering but used nowhere
Validation is ad-hoc; `admin.ts` product/coupon/banner writes have no validation at all.
**Fix:** Adopt Zod schemas from `@workspace/api-zod` (or local schemas) via a `validate()` middleware. Start with admin write endpoints.
**Files:** `artifacts/api-server/src/middlewares/validate.ts` (new), `routes/admin.ts`.

### M3 — Inconsistent delete-confirmation UX
`ConfirmDialog` component exists (used by 3 pages), but `BannersPage`/`UsersPage` use native `confirm()` and `PagesPage` hand-builds its own modal. The `confirmState` object is copy-pasted.
**Fix:** Standardize all destructive actions on `ConfirmDialog`; wrap in a `useConfirm()` hook.
**Files:** `artifacts/store/src/components/admin/ConfirmDialog.tsx`, `pages/admin/{BannersPage,UsersPage,PagesPage,ProductsPage,CategoriesPage}.tsx`.

### M4 — Audit-log writes duplicated ~25× in 3 styles
Blocking inline writes in `admin.ts` vs fire-and-forget helpers in `pages.ts` / `site-settings.ts`.
**Fix:** Single `lib/audit.ts` with one consistent (fire-and-forget, logged-on-failure) API.
**Files:** `artifacts/api-server/src/lib/audit.ts` (new), all admin write routes.

### M5 — i18n is one 918-line file typed as `any`
`messages.ts` holds all 3 locales inline; `t(key: string)` is untyped so typos silently return the key. Consistency enforced only by runtime tests.
**Fix:** Split per-locale (`messages/az.ts`, `ru.ts`, `en.ts`) with a shared `MessageSchema` type; derive a union key type for `t()`.
**Files:** `artifacts/store/src/lib/i18n/messages.ts` → `lib/i18n/messages/`, `context.tsx`.

### M6 — Storefront product grid + loading states duplicated
Grid block repeated in `ProductsPage`/`CategoryPage`; `SearchPage`/`WishlistPage` hand-roll cards instead of using `ProductCard`; `SearchPage` hand-rolls its own skeleton. `CategoryPage` has hardcoded Azerbaijani strings (violates i18n rule). `SORT_OPTIONS` dropdown duplicated.
**Fix:** Extract `<ProductGrid>` + `<SortDropdown>`; route loading through existing `ProductSkeletonGrid`; move hardcoded strings to `messages.ts`.
**Files:** `artifacts/store/src/components/storefront/` (new), `pages/storefront/{ProductsPage,CategoryPage,SearchPage,WishlistPage,HomePage}.tsx`.

### M7 — Inline CRUD form + modal pattern duplicated
`CategoriesPage`, `CouponsPage`, `BannersPage` each define near-identical labeled-input helpers and `openNew`/`openEdit`/`handleSave`/`handleDelete` logic.
**Fix:** Shared `<FormField>` / `<NumberField>` + `<CrudModal>` wrapper; optional `useCrudResource({ endpoint })` hook.
**Files:** `artifacts/store/src/components/admin/` (new), `pages/admin/{CategoriesPage,CouponsPage,BannersPage}.tsx`.

### M8 — Files over 400 lines mixing responsibilities
`PageEditorPage` 663, `DashboardPage` 657, `ProductsPage` (admin) 548, `ProductDetail` 514, `Header` 431, `ProfilePage` 405.
**Fix:** Extract inline modals/widgets/sub-components into their own files.
**Files:** as listed above.

---

## LOW IMPACT

### L1 — Supabase env-var resolution duplicated in 3 files
Store client, api-server, and test setup each re-implement the VITE→non-prefixed normalization. RPC calls (`decrement_stock_safe`, `increment_stock`, `search_products`) use `as any` with no typed wrapper.
**Fix:** One shared env util; typed RPC wrapper functions (`decrementStockSafe()`, etc.).
**Files:** `artifacts/store/src/lib/supabase/client.ts`, `artifacts/api-server/src/lib/supabase.ts`, `tests/setup.ts`.

### L2 — Inconsistent test layout
Store splits unit tests between `src/__tests__/` and `tests/` with no rule; store has no `tests/helpers/` (api-server has a good one). WIP exclusions in vitest configs indicate dead/disabled tests.
**Fix:** Pick one store unit-test location; add `tests/helpers/`; resolve excluded tests.
**Files:** `artifacts/store/vitest.config.ts`, test dirs.

### L3 — Config could hoist further
No root `vitest.workspace.ts`; repeated `"types": ["node"]` and identical `typecheck` scripts; redundant `--config` flags.
**Fix:** Add root `vitest.workspace.ts`; hoist shared compilerOptions to `tsconfig.base.json`.
**Files:** root configs, `tsconfig.base.json`.

### L4 — Dead code
`GET /profile/orders` defined twice (cart.ts copy is dead); unused `BASE` const in `lib/api.ts`; `lib/admin-fetch.ts` auth-header logic re-implemented in `useProfile.ts` and `WishlistPage.tsx`.
**Fix:** Remove dead copies; provide a shared `userFetch`/`getAuthHeader` helper.
**Files:** `artifacts/api-server/src/routes/cart.ts`, `artifacts/store/src/lib/api.ts`, `lib/hooks/useProfile.ts`, `pages/storefront/WishlistPage.tsx`.

---

## Recommended sequencing (risk-adjusted)

1. **H3** — wire in unused `coupon-calc`/`cart-merge` (tiny, fixes correctness divergence)
2. **H2 + M1** — auth middleware + central error handler (removes most boilerplate, improves security consistency)
3. **H1** — adopt generated types, kill `as any` incrementally
4. **H4 + H5** — `useAdminList` hook + shared table/pagination + data layer (collapses 7 admin pages)
5. Follow-up: H6, H7, M2–M8, L1–L4

Steps 1–4 capture ~80% of the value.
