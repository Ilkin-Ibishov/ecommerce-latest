# Whitelabel E-Commerce Store — Azerbaijan Market

A whitelabel PWA e-commerce platform for the Azerbaijan market. Customers browse products in AZ/RU/EN, authenticate via WhatsApp OTP, and pay cash-on-delivery. Admins manage products, orders, coupons, and categories through a dark-mode admin panel.

## Run & Operate

- `pnpm --filter @workspace/store run dev` — Next.js dev server (port 24964)
- `pnpm --filter @workspace/store run typecheck` — TypeScript check for the store
- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)

## Stack

- **Framework**: Next.js 15 App Router (React 19, TypeScript 5.9)
- **Database**: Supabase PostgreSQL (external) + @supabase/ssr
- **Auth**: WhatsApp OTP via Evolution API (console fallback in dev)
- **i18n**: next-intl v4 — locales: `az` (default), `ru`, `en`
- **UI**: Tailwind CSS v4 + shadcn/ui components
- **Admin theme**: Space Slate-Blue dark mode
- **Payments**: Cash on delivery only (AZN)

## Where things live

```
artifacts/store/
├── src/app/
│   ├── (storefront)/[locale]/    ← Storefront pages (/, /products, /categories…)
│   ├── (admin)/                  ← Admin route group
│   ├── admin/                    ← Admin pages (/admin, /admin/products…)
│   └── api/auth/otp/             ← OTP request + verify routes
├── src/components/
│   ├── auth/lazy-login-modal.tsx ← WhatsApp OTP login modal
│   ├── storefront/header.tsx     ← Storefront nav + search
│   └── admin/sidebar.tsx         ← Admin navigation
├── src/lib/
│   ├── supabase/                 ← client, server, middleware
│   ├── whatsapp/client.ts        ← Evolution API + console fallback
│   └── auth/otp.ts               ← OTP generate/hash/verify + rate limiting
├── src/types/database.ts         ← Full Supabase TypeScript types
├── messages/                     ← az.json, ru.json, en.json
├── supabase/schema.sql           ← Full DB schema — run in Supabase SQL Editor
└── middleware.ts                 ← Supabase session + next-intl routing
```

## Architecture decisions

- **Route groups**: `(storefront)` for locale-prefixed routes, `(admin)` for the dark admin panel — separate layouts without URL impact
- **OTP auth**: Custom bcrypt-hashed OTP stored in `otp_codes` table, not Supabase's built-in phone auth (more control over WhatsApp delivery)
- **No card payments**: All orders use COD (cash on delivery) in AZN — simplifies compliance
- **Evolution API fallback**: When `EVOLUTION_API_URL` is not configured, OTP codes are logged to the server console for development
- **RLS on all tables**: Full Supabase Row Level Security — customers see only their own orders, admins see everything via role check on `public.users`

## Product

- Storefront: i18n homepage with featured/sale/deal sections, category grid, full-text search
- Auth: WhatsApp OTP login modal (phone → 6-digit code → optional name collection)
- Admin: Space Slate-Blue dark dashboard, order management, product CRUD, coupons, comments moderation, audit log
- Policy pages: Terms, Privacy, Delivery — available in AZ/RU/EN

## User preferences

- Stack: Next.js 15, Supabase, next-intl, Tailwind v4, shadcn/ui
- Evolution API skipped for now (console fallback active); can be enabled later by setting EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME
- Currency: AZN only, COD payments
- Locales: az (default), ru, en

## Gotchas

- **Run the Supabase schema first**: `supabase/schema.sql` must be executed in the Supabase SQL Editor before auth or products work
- **middleware.ts must be at artifact root** (not inside src/) — Next.js requirement
- **No BASE_PATH for Next.js** — artifact serves at "/" and Next.js handles routing internally
- **Admin auth check**: Admin layout redirects non-admin users to /az — set `role = 'admin'` in `public.users` for the first admin user

## Pointers

- See `supabase/schema.sql` for the full DB schema with RLS policies
- See `.local/skills/pnpm-workspace` for workspace structure details
