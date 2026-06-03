---
inclusion: always
---

# Coding Standards & Conventions

## TypeScript

- Strict mode enabled (`strictNullChecks`, `noImplicitAny`, `noImplicitReturns`)
- Use `type` imports for type-only references: `import type { Foo } from "./foo"`
- Prefer `interface` for object shapes, `type` for unions/intersections
- No `any` — use `unknown` and narrow with type guards
- ESM throughout — all packages use `"type": "module"`

## Frontend (React / Store)

### Component Patterns
- Functional components only (no class components)
- Use shadcn/ui component library pattern (Radix + Tailwind + CVA)
- UI primitives live in `artifacts/store/src/components/ui/`
- Domain components in `artifacts/store/src/components/storefront/` or `artifacts/store/src/components/auth/`
- Pages in `artifacts/store/src/pages/storefront/` (customer) or `artifacts/store/src/pages/admin/` (admin)

### Styling
- Tailwind CSS v4 (utility-first, no CSS modules)
- Use `cn()` utility from `@/lib/utils` for conditional classes (clsx + tailwind-merge)
- Use CVA (class-variance-authority) for component variants

### State & Data Fetching
- TanStack React Query for server state
- React Context for global client state (cart, i18n)
- `wouter` for routing (NOT react-router)
- Use `useI18n()` hook for translations — never hardcode user-facing strings

### Routing
- Storefront routes: `/:locale/path` (locale = az | ru | en)
- Admin routes: `/admin/path` (no locale prefix)
- Use `<Redirect>` from wouter for redirects

### Imports
- Use `@/` alias for `artifacts/store/src/`
- Use `@assets/` alias for `attached_assets/`
- Use `@workspace/api-client-react` for generated API hooks

## Backend (Express / API Server)

### Route Structure
- Each domain has its own route file in `artifacts/api-server/src/routes/`
- Routes are mounted under `/api` prefix
- Use Express 5 Router (not app-level routes)
- Validate request bodies with Zod schemas from `@workspace/api-zod`

### Database Access
- Use Supabase client (`@supabase/supabase-js`) with service role key for privileged operations
- For complex queries, use Drizzle ORM from `@workspace/db`
- Always use RPC functions for stock operations (never raw UPDATE)

### Error Handling
- Return consistent JSON error responses: `{ error: string, details?: unknown }`
- Use appropriate HTTP status codes
- Log errors with pino logger

### Auth Middleware
- Extract Supabase auth token from `Authorization: Bearer <token>` header
- Verify with `supabase.auth.getUser(token)`
- Admin routes must check `user.role === 'admin'`

## Database

- Schema defined in `supabase/schema.sql` (source of truth for Supabase)
- Drizzle schema in `lib/db/src/schema/` (for ORM usage in API server)
- All tables have RLS enabled
- Use `gen_random_uuid()` for primary keys
- Translations in separate `*_translations` tables with `lang_code` column
- Always include `created_at` and `updated_at` timestamps

## i18n

- Three supported locales: `az` (Azerbaijani), `ru` (Russian), `en` (English)
- Default locale: `az`
- Translation keys in `artifacts/store/src/lib/i18n/messages.ts`
- All user-facing text must go through `t()` function
- Database content uses `*_translations` tables (not i18n keys)

## Git & Commits

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`
- One logical change per commit
- Never commit `.env` files or secrets
