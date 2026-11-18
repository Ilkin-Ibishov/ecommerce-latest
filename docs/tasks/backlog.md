# Architecture Refactoring Backlog

Status: active — refactoring backlog, re-verified against the code 2026-11-18.

Copy-paste and type-safety debt, not emergencies. Written 2026-11-02 from a full architecture audit;
every item re-checked against `main` on 2026-11-18 with `git grep` (counts exclude tests). Done items
are listed once at the end. The original audit text is in git history (`git log -- docs/tasks/backlog.md`).

## Open

### H1 — `as any` (type safety) — HIGH
`as any`: **299** in `artifacts/api-server/src`, **32** in `artifacts/store/src`; `: any` annotations: 84
and 145. It is concentrated in the admin and stock routes: `routes/admin/products.ts`
(36), `admin/receipts.ts` (35), `routes/inventory.ts` (34), `admin/stocktakes.ts` (31),
`admin/reservations.ts` (29), `admin/stocktake-lines.ts` (23). `SupabaseClient<Database>` is used in
20 places and `(supabase as any)` in 19; `@workspace/api-zod` is imported by 6 files.
**Fix:** type the Supabase client and RPC results file by file, starting with the files above. Never
add a new `as any` (AGENTS.md already forbids it).

### H4 — Admin list pages re-implement list state — HIGH
`useAdminList` + `<DataTable>` exist (`lib/hooks/useAdminList.ts`, `components/admin/DataTable.tsx`),
but only `AuditPage`, `BrandsPage`, `OrdersPage`, `UsersPage` (and platform `PlansPage`,
`StoreDashboardPage`) use them. List pages still hand-rolling load/pagination/search: `ProductsPage`,
`InventoryPage`, `CategoriesPage`, `CouponsPage`, `CommentsPage`, `BannersPage`, `PagesPage`,
`BundlesPage`, `SuppliersPage`, `ReceiptsPage`, `StocktakesPage`, `ReservationsPage`,
`CounterSalesPage`. The 2026-11-02 note "mostly done" was wrong.
**Fix:** migrate one page per change, simplest first (`CouponsPage`, `BannersPage`).

### H5 — Raw Supabase queries in components — MEDIUM
`lib/queries/` (`categories`, `fragments`, `orders`, `products`) has 6 importers, while
`supabase.from(` is still called **26** times directly from `pages/` and `components/`.
**Fix:** move a query into `lib/queries/` when its page is next touched.

### H6 — Translation picker re-implemented — LOW
`getTranslatedField` has 23 call sites; **12** inline `.find(... lang_code ...)` pickers remain.

### M1 — Raw database errors returned to clients — MEDIUM (security hygiene)
The central `errorHandler` (registered in `app.ts`) answers 500 with a generic message. But **59**
handlers in 25 route files return the Supabase/PostgREST text directly, e.g.
`routes/admin/banners.ts:23` `res.status(400).json({ error: error.message })`. That exposes
table, column and constraint names to any caller.
**Fix:** map database errors to a generic message (log the detail); keep 4xx texts we write ourselves.

### M2 — Write routes without `validate()` — MEDIUM
`middlewares/validate.ts` is used 24 times. Of 42 route files with a POST/PUT/PATCH handler, 31
contain no `validate(` at all — including `admin/counter-sales.ts`, `admin/receipts.ts`,
`admin/stocktakes.ts`, `admin/reservations.ts`, `admin/users.ts`, `cart.ts`, `products.ts`
(file-level check: some may validate inline).
**Fix:** add Zod schemas to write endpoints, money and stock paths first.

### M3 — Native `confirm()` left in 5 places — LOW
`components/admin/counter/PickupPanel.tsx:31`, `pages/admin/BundlesPage.tsx:53`,
`ReservationsPage.tsx:57`, `StocktakeCountPage.tsx:122`, `StocktakeVariancePage.tsx:54`. Their
texts are hardcoded Azerbaijani or English, so they also break the i18n rule.
**Fix:** `useConfirm()` + `<ConfirmDialog>` with dictionary keys.

### M7 — Inline CRUD form + modal duplicated — LOW
No shared `<FormField>` / `<CrudModal>`. `CategoriesPage`, `CouponsPage`, `BannersPage` each define
their own labelled-input helpers and open/edit/save/delete logic.

### M8 — Files over 400 lines — LOW
Store: `pages/admin/InventoryPage.tsx` 648, `DashboardPage.tsx` 637, `BrandsPage.tsx` 538,
`PageEditorPage.tsx` 528, `ProductsPage.tsx` 408, `components/storefront/ProductDetail.tsx` 466,
`pages/storefront/ProductsPage.tsx` 441. API: `routes/platform/lifecycle.ts` 591, `routes/pages.ts`
566, `routes/product-images.ts` 562, `lib/billing/scheduler.ts` 481, `routes/inventory.ts` 459,
`routes/platform/plans.ts` 451, `lib/notifications/delivery.ts` 450, `routes/platform/auth.ts` 437,
`routes/platform/offboarding.ts` 426. (Generated `components/ui/sidebar.tsx` excluded.)
**Fix:** extract when a file is next changed for a feature; not as standalone work.

## Suggested order
1. **M1** — small, mechanical, closes an information leak.
2. **M2** on the money and stock write paths.
3. **H1** in the six route files named above.
4. **H4**, one list page per change.
5. The rest when the files are touched anyway.

## Done (verified 2026-11-18)
| Item | Evidence |
|---|---|
| H2 auth middleware | `middlewares/requireAdmin.ts`, `requireUser.ts`, `requireStaffOrAdmin.ts`; 3 inline `requireAdmin(req` calls left |
| H3 tested coupon/cart functions wired in | `coupon-calc` imported by `routes/orders.ts`, `routes/coupons.ts`; `cart-merge` by `routes/cart.ts` |
| H7 `admin.ts` split | `routes/admin/` has 24 files; `routes/admin.ts` is gone |
| M1 central error handler | `middlewares/errorHandler.ts`, registered in `app.ts` (the leak above is the open part) |
| M4 audit logging | `writeAudit(` 45 call sites; no inline `audit_logs` writes |
| M5 i18n split | `lib/i18n/messages/{az,en,ru,schema,index}.ts` |
| M6 storefront grid | `ProductGrid.tsx`, `SortDropdown.tsx`, `ProductSkeleton.tsx` |
| L1 env + RPC | `resolveSupabaseEnv` in 7 files; `lib/rpc.ts` |
| L3 root config | `vitest.workspace.ts` |
| L4 dead code | `userFetch(` 11 call sites; no duplicate `/profile/orders` route |
| S1 checkout `maxLength` | 8 `maxLength` attributes in `CheckoutPage.tsx` |

Not re-checked: L2 (store test layout). The 2026-11-02 banner called it done.
