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
pnpm --filter @workspace/api-server run dev   # port 5000
pnpm --filter @workspace/store run dev        # port 3000
```
