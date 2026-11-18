# Store & admin frontend (`artifacts/store`)

React + TypeScript + Vite, Tailwind, shadcn/ui (Radix + CVA), wouter routing, TanStack Query.

## Layout
- `src/components/ui/` — shadcn/ui primitives
- `src/components/storefront/` — customer-facing (`ProductCard`, `Header`, `ProductGrid`)
- `src/components/admin/` — shared admin UI (`DataTable`, `Pagination`, `SearchInput`, `ConfirmDialog`)
- `src/lib/i18n/messages/` — dictionaries `az.ts`, `ru.ts`, `en.ts`
- `src/lib/queries/` — Supabase data fetching

## Routes
- Storefront: `/${locale}/<path>` in `App.tsx` (`StorefrontRoutes`); components take `{ locale: string }`.
- Admin: `/admin/<path>` in `App.tsx` (`AdminRoutes`).

## Rules
- **No hardcoded UI strings.** Every visible string uses `t("key")`; a new key goes into all three
  dictionaries (the `i18n-consistency` test enforces identical keys). Skill `locale-key-add`.
  Database translations: `getTranslatedField(translations, locale, field, fallback)` from `@/lib/utils`.
- **Admin lists** use `useAdminList` + `<DataTable>`, `<Pagination>`, `<SearchInput>`,
  `<TableEmptyState>`. The hook owns the 350 ms debounce, so pass `debounceMs={0}` to `<SearchInput>`.
  Destructive actions confirm with `useConfirm()` + `<ConfirmDialog>`.
- **API**: generated hooks from `@workspace/api-client-react`, or `apiUrl()` from `lib/api.ts`.
- Export components from their own file — no barrel `index.ts`. Classes via `cn(...)` from `@/lib/utils`.
- No heavy third-party widget library without a design note.

## Modern Web Guidance (before writing UI code)
- Run `npx -y modern-web-guidance@latest search "<2-5 word query>"`, then `retrieve "<id>"`.
  Query the user-visible capability (`"light dismiss dialog"`), not our file names. Split
  multi-feature tasks into separate searches.
- Prefer the platform feature the guide names over a hand-rolled pattern or a new dependency.
- If `search` returns nothing relevant after one rephrase, proceed without it and say so.
- Not for `artifacts/api-server/**`, `supabase/migrations/**`, SQL, CI or tooling.

## Known open finding
`legacy-scan`, 2026-11-13: four Enter-to-submit handlers lack an `event.isComposing` guard —
`admin/ImageSearchTab.tsx:71`, `admin/PriceCell.tsx:37`, `admin/StockCell.tsx:78`,
`storefront/profile/InlineEditor.tsx:54`. Breaks IME input only; fix when next touching those files.
