---
inclusion: always
---

# Project Overview

**pnpm monorepo** — white-label e-commerce for Azerbaijan market.

| Package | Path | Purpose |
|---------|------|---------|
| `@workspace/store` | `artifacts/store` | React 19 SPA (storefront + admin) |
| `@workspace/api-server` | `artifacts/api-server` | Express 5 REST API |

**Stack:** TypeScript strict · Vite 7 · Tailwind v4 · wouter · Supabase (PostgreSQL + Auth + Storage)  
**Deployment:** Vercel auto-deploy from `main` · `https://ecommerce-latest-api-server.vercel.app`  
**GitHub:** `Ilkin-Ibishov/ecommerce-latest`

**Key patterns:**
- Cart: `artifacts/store/src/lib/cart/context.tsx` — validates localStorage, exposes `getItemQty()`
- i18n: `useI18n()` → `t(key)` — all user strings must use it, 3 locales (az/ru/en)
- Admin auth: `requireAdmin()` in all admin API routes
- Stock changes: always use RPC `decrement_stock_safe` / `increment_stock`
- Locale routing: `/az/`, `/ru/`, `/en/` prefixes on storefront; `/admin/` no prefix

**Commands:** `pnpm run typecheck` · `pnpm run build`

> For full details use `#project-details` or see `.kiro/steering/project-details.md`
