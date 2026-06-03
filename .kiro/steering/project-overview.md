---
inclusion: always
---

# Project Overview — White Label E-Commerce Platform

## Architecture

This is a **pnpm monorepo** for a white-label e-commerce platform targeting the Azerbaijan market.

### Workspace Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@workspace/store` | `artifacts/store` | React SPA — storefront + admin dashboard |
| `@workspace/api-server` | `artifacts/api-server` | Express 5 REST API |
| `@workspace/db` | `lib/db` | Drizzle ORM database layer |
| `@workspace/api-spec` | `lib/api-spec` | OpenAPI 3.1 specification (source of truth) |
| `@workspace/api-zod` | `lib/api-zod` | Generated Zod schemas from OpenAPI |
| `@workspace/api-client-react` | `lib/api-client-react` | Generated React Query hooks from OpenAPI |

### Tech Stack

- **Runtime:** Node.js (ESM throughout)
- **Language:** TypeScript 5.9 (strict mode, ES2022 target, bundler module resolution)
- **Frontend:** React 19 + Vite 7 + Tailwind CSS v4 + Radix UI (shadcn pattern) + wouter + TanStack React Query
- **Backend:** Express 5 + pino logging + esbuild bundling
- **Database:** PostgreSQL via Supabase (RLS, FTS, triggers, RPC functions)
- **Auth:** Supabase Auth (phone OTP, WhatsApp notifications)
- **Package Manager:** pnpm with workspace catalogs

### Key Patterns

1. **OpenAPI-first development** — `lib/api-spec/openapi.yaml` is the contract. Orval generates typed hooks and Zod schemas.
2. **Locale-based routing** — All storefront routes prefixed with language code (`/az/`, `/ru/`, `/en/`).
3. **I18n via context** — `useI18n()` hook provides `t(key)` function; translations in `artifacts/store/src/lib/i18n/messages.ts`.
4. **Supabase as BaaS** — Auth, PostgreSQL with RLS, Storage for product images.
5. **Row Level Security** — Database-level access control; API server uses service role for privileged ops.
6. **Atomic stock management** — Postgres RPC functions (`decrement_stock_safe`, `increment_stock`).
7. **Component library** — shadcn/ui pattern: Radix primitives + Tailwind + CVA in `artifacts/store/src/components/ui/`.
8. **Cart context** — React context at `artifacts/store/src/lib/cart/context.tsx`.

### Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_API_URL` — API base URL for frontend (defaults to `/api`)
- `PORT` — Server port (API: 5000, Store: 3000)
- `BASE_PATH` — Vite base path (defaults to `/`)

### Commands

```bash
# Install dependencies
pnpm install

# Typecheck everything
pnpm run typecheck

# Build all packages
pnpm run build

# Dev — API server (port 5000)
pnpm --filter @workspace/api-server run dev

# Dev — Store frontend (port 3000)
pnpm --filter @workspace/store run dev
```
