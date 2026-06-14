---
inclusion: always
---

# Project Overview

**pnpm monorepo** — white-label e-commerce for Azerbaijan market.

| Package | Path | Purpose |
|---------|------|---------|
| `@workspace/store` | `artifacts/store` | React 19 SPA (storefront + admin) |
| `@workspace/api-server` | `artifacts/api-server` | Express 5 REST API |
| `@workspace/supabase-types` | `artifacts/supabase-types` | Generated Supabase `Database` type + `Tables<>` helper (single source of truth; consumed by both packages) |
| `@workspace/db` | `lib/db` | Drizzle schema (NOT the Supabase `Database` type — that lives in `@workspace/supabase-types`) |
| `@workspace/api-zod` | `lib/api-zod` | Zod schemas/types generated from OpenAPI |

**Stack:** TypeScript strict · Vite 7 · Tailwind v4 · wouter · Supabase (PostgreSQL + Auth + Storage)  
**Deployment:** Vercel auto-deploy from `main` · `https://ecommerce-latest-api-server.vercel.app`  
**GitHub:** `Ilkin-Ibishov/ecommerce-latest`

**Key patterns:**
- Cart: `artifacts/store/src/lib/cart/context.tsx` — validates localStorage, exposes `getItemQty()`
- i18n: `useI18n()` → `t(key)` — all user strings must use it, 3 locales (az/ru/en). Messages live in `lib/i18n/messages/{az,ru,en}.ts` (per-locale modules; `t()` key type is `MessageKey | (string & {})`)
- Typed Supabase: `getSupabase()/getAdminSupabase()` return `SupabaseClient<Database>` (`Database` from `@workspace/supabase-types`) — avoid `(x as any)` on Supabase data
- Admin auth (API): `requireAdmin` / `requireUser` Express **middleware** in `src/middlewares/` (attached per-route; sets `req.admin`/`req.user`/`req.authUser`). NOT inline checks.
- Central error handling: async errors auto-forward to `errorHandler` (returns generic 500, never leaks `err.message`/`err.stack`). Don't wrap handlers in try/catch just to return 500.
- Coupon math / cart merge: use `lib/coupon-calc.ts` `calculateDiscount()` and `lib/cart-merge.ts` `mergeGuestCart()` (cap 99) — never reimplement inline
- Audit log: `lib/audit.ts` `writeAudit()` (fire-and-forget) — never inline `audit_log` inserts
- Admin write validation: `validate(schema)` Zod middleware (`src/middlewares/validate.ts`)
- Stock changes: always via typed RPC wrappers in `lib/rpc.ts` (`decrementStockSafe`/`incrementStock`) → `decrement_stock_safe` / `increment_stock`
- Env resolution: `resolveSupabaseEnv()` (mirrored `lib/env.ts` in both packages)
- Admin list pages: `useAdminList()` hook + `DataTable`/`Pagination`/`TableEmptyState` (`components/admin/`); shared Supabase reads in `lib/queries/`
- Translation pick: `getTranslatedField(translations, locale, field, fallback)` (`lib/utils.ts`) — handles `lang_code` and `locale` shapes
- Locale routing: `/az/`, `/ru/`, `/en/` prefixes on storefront; `/admin/` no prefix
- Admin API routes: split by domain under `src/routes/admin/*` (aggregated by `admin/index.ts`). Literal routes (e.g. `/admin/products/bulk-flag`, `/bulk`) MUST be registered before `/:id` param routes

**Commands:** `pnpm run typecheck` · `pnpm run build` · `pnpm run test` (unit) · `pnpm --filter @workspace/store run test:e2e` (E2E)

**Testing:** 3-layer strategy — unit/property (vitest, 700+ tests), E2E (Playwright, 4 specs), exploratory (ScoutQA CLI)

**CI/CD:** GitHub Actions on every push to `main`. Two jobs: `unit` (typecheck + 415 unit tests, fast gate) and `integration-e2e` (API + E2E with Supabase). Node 22.

> For full details use `#project-details` or see `.kiro/steering/project-details.md`
