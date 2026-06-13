---
inclusion: manual
---

# Full Project Details

## Architecture

pnpm monorepo for a white-label e-commerce platform targeting the Azerbaijan market.

### All Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@workspace/store` | `artifacts/store` | React SPA — storefront + admin dashboard |
| `@workspace/api-server` | `artifacts/api-server` | Express 5 REST API |
| `@workspace/db` | `lib/db` | Drizzle ORM database layer |
| `@workspace/api-spec` | `lib/api-spec` | OpenAPI 3.1 specification |
| `@workspace/api-zod` | `lib/api-zod` | Generated Zod schemas |
| `@workspace/api-client-react` | `lib/api-client-react` | Generated React Query hooks |

### Tech Stack

- **Runtime:** Node.js (ESM throughout)
- **Language:** TypeScript 5.9 (strict mode, ES2022, bundler resolution)
- **Frontend:** React 19 + Vite 7 + Tailwind CSS v4 + Radix UI + wouter + TanStack Query
- **Backend:** Express 5 + pino + esbuild bundling
- **Database:** PostgreSQL via Supabase (RLS, FTS, triggers, RPC)
- **Auth:** Supabase Auth (phone OTP, WhatsApp via UltraMsg)

### Deployment

- Vercel (auto-deploy from GitHub `main`)
- Store SPA from CDN, `/api/*` → serverless Express function
- URL: `https://ecommerce-latest-api-server.vercel.app`

### Environment Variables

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ULTRAMSG_INSTANCE`, `ULTRAMSG_TOKEN` (WhatsApp — must be set in Vercel)
- `VITE_API_URL` — API base URL (defaults to `/api`)
- `PORT` — Server port (API: 5000, Store: 3000)

### Commands

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm run test                                    # Run all vitest tests
pnpm exec vitest --run --project store-unit      # Store unit tests only (415)
pnpm --filter @workspace/store run test:e2e      # Playwright E2E (local)
BASE_URL=https://...vercel.app pnpm --filter @workspace/store run test:e2e  # E2E against deployed
pnpm --filter @workspace/api-server run dev      # port 5000
pnpm --filter @workspace/store run dev           # port 3000
```

## Testing Infrastructure

### Test Strategy (3 layers)

| Layer | Tool | When | Count |
|-------|------|------|:-----:|
| Unit / Property | Vitest + fast-check | Every push (CI `unit` job) | 700+ |
| E2E (deterministic) | Playwright | CI `integration-e2e` job | ~20 |
| Exploratory (AI) | ScoutQA CLI | Post-deploy (manual/on-demand) | ∞ |

### Vitest Workspace (`vitest.workspace.ts`)

| Project | Config | Scope |
|---------|--------|-------|
| `store-unit` | `artifacts/store/vitest.config.ts` | Store unit + property tests |
| `api-integration` | `artifacts/api-server/vitest.config.ts` | API integration + property tests |
| `env-validation` | `artifacts/api-server/vitest.config.env-test.ts` | Env var validation (isolated) |

### Playwright E2E (`artifacts/store/playwright.config.ts`)

- `storefront-browsing.spec.ts` — Homepage, products, detail, locale switching
- `cart-flow.spec.ts` — Add to cart, drawer, qty controls, persistence
- `checkout-flow.spec.ts` — Form validation, phone format, coupon, auth gate
- `search-and-navigation.spec.ts` — Search, 404 handling, nav links, CMS pages
- `admin-panel.spec.ts` — Admin login, product CRUD, pages, settings

### CI/CD (`.github/workflows/test.yml`)

Two jobs:
1. **`unit`** — Node 22, `pnpm install` → `typecheck` → `vitest --project store-unit`. Fast gate (~40s), no secrets needed. Must always be green.
2. **`integration-e2e`** (needs: `unit`) — Node 22, Supabase secrets, seed data, API + store servers, Playwright. Runs integration tests + E2E.

Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (set via `gh secret set`).

### ScoutQA (exploratory)

```bash
scoutqa --url "https://your-url.vercel.app" --prompt "Test the checkout flow..."
scoutqa list-executions
```

Installed via `npm i -g @scoutqa/cli@latest`. Authenticated via `scoutqa auth login`.
