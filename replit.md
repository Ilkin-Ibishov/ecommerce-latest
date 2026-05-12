# Whitelabel E-Commerce Store — Azerbaijan Market

A whitelabel PWA e-commerce platform for the Azerbaijan market. Customers browse products in AZ/RU/EN, authenticate via WhatsApp OTP, and pay cash-on-delivery. Admins manage products, orders, coupons, and categories through a dark-mode admin panel.

---

## Run & Operate

```
pnpm --filter @workspace/store run dev          # Next.js dev server (port 24964)
pnpm --filter @workspace/store run typecheck    # TypeScript check (no build needed)
pnpm --filter @workspace/api-server run dev     # API server (port 8080, currently unused by storefront)
```

Preview at `/` — Next.js serves at root with no BASE_PATH.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 App Router (React 19, TypeScript 5.9) |
| Database | Supabase PostgreSQL (external) + `@supabase/ssr` |
| Auth | WhatsApp OTP via Evolution API (console fallback in dev) |
| i18n | next-intl v4 — locales: `az` (default), `ru`, `en` |
| UI | Tailwind CSS v4 + shadcn/ui components |
| Admin theme | Space Slate-Blue dark mode |
| Payments | Cash on delivery only (AZN) |
| Images | Supabase Storage bucket `product-images` (public, auto-created) |

---

## Environment Secrets

All set in Replit Secrets:

| Secret | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin server actions |
| `SESSION_SECRET` | Session signing |
| `EVOLUTION_API_URL` | WhatsApp gateway (optional — console fallback when absent) |
| `EVOLUTION_API_KEY` | Evolution API key |
| `EVOLUTION_INSTANCE_NAME` | Evolution instance name |

WhatsApp is **disabled by default** — OTP codes log to console. Enable by setting all three `EVOLUTION_*` secrets.

---

## Database (Supabase)

**Project ref**: `pnzhfqgrlcmwjzcdduxh`
**Schema file**: `artifacts/store/supabase/schema.sql` — must be run manually in Supabase SQL Editor before auth or products work.

### Tables

| Table | Purpose |
|---|---|
| `public.users` | Customer/admin profiles linked to `auth.users` |
| `public.otp_codes` | bcrypt-hashed OTP codes with expiry + attempt tracking |
| `public.products` | Product catalog (slug, price, stock, flags) |
| `public.product_translations` | i18n titles/descriptions per lang_code |
| `public.product_images` | Ordered image URLs per product |
| `public.product_categories` | Many-to-many products ↔ categories |
| `public.categories` | Category tree (parent_id for hierarchy) |
| `public.category_translations` | i18n category names |
| `public.cart_items` | Session/user-scoped cart (not used — cart is localStorage) |
| `public.orders` | Customer orders (COD, AZN, status enum) |
| `public.order_items` | Snapshot of product title/price at order time |
| `public.coupons` | Discount codes (percentage/fixed, per-user limits, validity) |
| `public.coupon_usages` | Tracks which user used which coupon |
| `public.wishlists` | User wishlist items |
| `public.comments` | Product reviews (requires approval) |
| `public.notifications` | WhatsApp notification queue |
| `public.audit_log` | Admin action audit trail |

### Key column gotcha
`audit_log` columns: `actor_id`, `action`, `entity`, `entity_id`, `changes` (NOT `admin_id`, `entity_type`, `new_data`).

### RLS
Full Row Level Security on all tables. Customers see only their own orders. Admins bypass via service role key in `createAdminClient()`.

---

## File Map

```
artifacts/store/
├── middleware.ts                              ← Supabase session refresh + next-intl routing (MUST be at root)
├── next.config.ts                             ← next-intl plugin, image domains (*.supabase.co)
├── supabase/schema.sql                        ← Full DB schema with RLS — run in Supabase SQL Editor
├── messages/
│   ├── az.json                                ← Azerbaijani translations (default locale)
│   ├── ru.json                                ← Russian translations
│   └── en.json                                ← English translations
└── src/
    ├── app/
    │   ├── layout.tsx                         ← Root layout: CartProvider, fonts
    │   ├── (storefront)/
    │   │   ├── layout.tsx                     ← Storefront shell (no URL impact)
    │   │   └── [locale]/
    │   │       ├── layout.tsx                 ← Header + cart drawer per locale
    │   │       ├── page.tsx                   ← Homepage: hero, categories, deal, featured, sale
    │   │       ├── products/
    │   │       │   ├── page.tsx               ← Product listing (filter by sale/deal, pagination)
    │   │       │   └── [slug]/page.tsx        ← Product detail: gallery, add-to-cart, comments
    │   │       ├── categories/
    │   │       │   ├── page.tsx               ← All categories grid
    │   │       │   └── [slug]/page.tsx        ← Category product listing with pagination
    │   │       ├── search/page.tsx            ← Full-text search via search_products RPC
    │   │       ├── checkout/page.tsx          ← Checkout form + coupon + order submit
    │   │       └── policies/
    │   │           ├── terms/page.tsx
    │   │           ├── privacy/page.tsx
    │   │           └── delivery/page.tsx
    │   ├── (admin)/layout.tsx                 ← Admin shell (no URL impact)
    │   └── admin/
    │       ├── layout.tsx                     ← Admin auth guard (role='admin' required) + sidebar
    │       ├── page.tsx                       ← Dashboard: stats cards + recent orders table
    │       ├── products/
    │       │   ├── page.tsx                   ← Products list with image/flags/actions
    │       │   ├── new/page.tsx               ← New product form
    │       │   └── [id]/edit/page.tsx         ← Edit product form
    │       ├── orders/
    │       │   ├── page.tsx                   ← Orders list (filter by status, pagination)
    │       │   └── [id]/page.tsx              ← Order detail: customer info, items, status update
    │       ├── categories/page.tsx            ← Category manager (CRUD inline)
    │       ├── coupons/page.tsx               ← Coupon manager (CRUD inline)
    │       ├── comments/page.tsx              ← Comment moderation (approve/delete)
    │       └── audit/page.tsx                 ← Audit log (paginated)
    │
    ├── api/
    │   ├── auth/
    │   │   ├── otp/request/route.ts           ← POST: generate OTP, send WhatsApp (or console)
    │   │   ├── otp/verify/route.ts            ← POST: verify OTP, create/find Supabase user + session
    │   │   └── signout/route.ts               ← POST: sign out
    │   ├── orders/route.ts                    ← POST: create order (stock check, coupon, WhatsApp confirm)
    │   ├── coupons/validate/route.ts          ← POST: validate coupon code + per-user usage check
    │   └── admin/
    │       ├── upload/route.ts                ← POST: image upload → Supabase Storage
    │       ├── products/route.ts              ← POST: create product + translations + images + categories
    │       ├── products/[id]/route.ts         ← PATCH/DELETE: update or delete product + audit log
    │       ├── categories/route.ts            ← POST: create category + translations
    │       ├── categories/[id]/route.ts       ← PATCH/DELETE: update or delete category
    │       ├── coupons/route.ts               ← POST: create coupon
    │       ├── coupons/[id]/route.ts          ← PATCH/DELETE: update or delete coupon
    │       ├── comments/[id]/route.ts         ← PATCH: approve/reject | DELETE: remove
    │       └── orders/[id]/status/route.ts    ← PATCH: update order status + WhatsApp notify + audit log
    │
    ├── components/
    │   ├── auth/
    │   │   └── lazy-login-modal.tsx           ← WhatsApp OTP modal (phone → code → name)
    │   ├── storefront/
    │   │   ├── header.tsx                     ← Nav bar: logo, links, search, wishlist, cart, auth
    │   │   ├── cart-drawer.tsx                ← Slide-out cart with badge, quantities, checkout link
    │   │   ├── checkout-client.tsx            ← Client-side checkout form (coupon, address, submit)
    │   │   ├── locale-switcher.tsx            ← AZ/RU/EN language switcher
    │   │   └── product-detail.tsx             ← Image gallery, add-to-cart, comments display
    │   ├── admin/
    │   │   ├── sidebar.tsx                    ← Admin sidebar navigation
    │   │   ├── product-form.tsx               ← Full product CRUD form (i18n, images, categories)
    │   │   ├── category-manager.tsx           ← Inline category CRUD with translations
    │   │   ├── coupon-manager.tsx             ← Inline coupon CRUD
    │   │   ├── comments-manager.tsx           ← Comment moderation UI
    │   │   ├── order-status-form.tsx          ← Order status update form
    │   │   └── delete-product-button.tsx      ← Delete with confirmation
    │   └── ui/                                ← shadcn/ui components (do not edit directly)
    │
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts                      ← createBrowserClient() for client components
    │   │   ├── server.ts                      ← createClient() and createAdminClient() for server
    │   │   └── middleware.ts                  ← updateSession() for middleware.ts
    │   ├── auth/
    │   │   └── otp.ts                         ← generateOTP, hashOTP, verifyOTP, validateAzPhone
    │   ├── cart/
    │   │   └── context.tsx                    ← CartProvider + useCart() — localStorage persistence
    │   ├── whatsapp/
    │   │   └── client.ts                      ← sendWhatsAppOTP / OrderConfirmation / StatusUpdate
    │   └── utils.ts                           ← cn() utility
    │
    ├── types/
    │   └── database.ts                        ← Supabase TypeScript types (all tables typed)
    ├── i18n/
    │   ├── request.ts                         ← next-intl server config
    │   └── routing.ts                         ← Locale routing: az (default), ru, en
    └── hooks/
        ├── use-mobile.tsx
        └── use-toast.ts
```

---

## Architecture Decisions

### Route Groups
- `(storefront)/[locale]/` — customer-facing pages with locale prefix in URL
- `(admin)/` + `admin/` — dark-mode admin panel, no locale prefix, auth-guarded at layout level

### OTP Auth Flow
1. `POST /api/auth/otp/request` → generate 6-digit code, bcrypt-hash it, store in `otp_codes`, send via WhatsApp (or console log)
2. `POST /api/auth/otp/verify` → verify code, create/find Supabase auth user, upsert `public.users`, return session tokens
3. Client stores session in cookies via `@supabase/ssr`
4. Optional name collection step in the modal after first login

### Cart
- **localStorage only** — `CartProvider` in `src/app/layout.tsx`
- No server-side cart sync (the `cart_items` table exists in schema but is not used)
- Cart is cleared after successful order submission

### Admin Auth Guard
- `admin/layout.tsx` calls `createClient()` → checks `public.users.role === 'admin'`
- Redirects non-admins to `/az`
- To make a user admin: `UPDATE public.users SET role = 'admin' WHERE phone = '+994XXXXXXXXX';` in Supabase SQL Editor

### Image Uploads
- Admin uploads → `POST /api/admin/upload` → Supabase Storage bucket `product-images`
- Bucket is auto-created as public if it doesn't exist
- `next.config.ts` allows images from `*.supabase.co` and `*.supabase.in`

### i18n
- Default locale `az` — URLs: `/az/products`, `/ru/products`, `/en/products`
- All storefront text in `messages/{az,ru,en}.json`
- Admin panel is English-only (no i18n)

### WhatsApp Notifications
Three functions in `src/lib/whatsapp/client.ts`:
- `sendWhatsAppOTP(phone, code)` — on OTP request
- `sendWhatsAppOrderConfirmation(phone, orderId, total)` — on order creation
- `sendWhatsAppStatusUpdate(phone, orderId, status)` — on admin status change

All three check `isConfigured` and fall back to `console.log` in dev.

---

## Critical TypeScript Gotcha

**The `database.ts` types have no `Relationships` declarations.** This means every Supabase query that uses joins (`.select("*, related_table(*)")`) or mutations will return/expect `never` from TypeScript.

**Fix pattern used throughout the codebase:**
```typescript
// Server components with joins:
const { data: rawProducts } = await (supabase as any)
  .from("products")
  .select("*, product_images(*), product_translations(*)")
const products = (rawProducts ?? []) as any[];

// API routes — requireAdmin helper pattern:
const { data: profile } = await (supabase as any)
  .from("users").select("role").eq("id", user.id).single();
if ((profile as any)?.role !== "admin") return null;

// Admin mutations:
await (admin as any).from("products").update({ ... }).eq("id", id);
```

This is intentional — adding full Relationships to `database.ts` would require 200+ lines and would normally be auto-generated by Supabase CLI. The `as any` pattern is consistent and safe because the runtime queries are correct.

---

## What Is Built (Complete)

### Storefront
- [x] Homepage: hero banner, category grid, deal-of-day, featured products, on-sale products
- [x] Product listing page: filter by sale/deal, pagination, sidebar category links
- [x] Product detail page: image gallery, add-to-cart, comments display
- [x] Category listing page: all root categories grid
- [x] Category detail page: products in category with pagination
- [x] Full-text search page (via `search_products` PostgreSQL function)
- [x] Cart: localStorage context, slide-out drawer, badge counter, qty controls
- [x] Checkout page: address form, coupon code validation, order submission
- [x] Auth: WhatsApp OTP modal (phone → code → name), sign in/out
- [x] Policy pages: Terms, Privacy, Delivery (AZ/RU/EN)
- [x] i18n: AZ (default), RU, EN — language switcher in header

### Admin Panel
- [x] Dashboard: stats (orders, revenue, products, low stock), recent orders table
- [x] Products list: thumbnail, slug, price, stock, flags, edit/delete actions
- [x] New product form: i18n titles/descriptions, image upload, category assignment, all flags
- [x] Edit product form: pre-populated, same capabilities as new
- [x] Orders list: filter by status (7 statuses), pagination
- [x] Order detail: customer info, financial breakdown, line items, status update form
- [x] Categories manager: inline create/edit/delete with i18n translations
- [x] Coupons manager: inline create/edit/delete (percentage/fixed, limits, validity dates)
- [x] Comments moderation: approve/reject/delete with product context
- [x] Audit log: paginated action log with actor, action, entity

### API Routes
- [x] `POST /api/auth/otp/request` — rate-limited OTP generation
- [x] `POST /api/auth/otp/verify` — OTP verification + Supabase user creation
- [x] `POST /api/auth/signout`
- [x] `POST /api/orders` — full order creation with stock check, coupon, WhatsApp confirm
- [x] `POST /api/coupons/validate` — coupon validation with per-user usage check
- [x] `POST /api/admin/upload` — image upload to Supabase Storage
- [x] `POST/PATCH/DELETE /api/admin/products[/id]`
- [x] `POST/PATCH/DELETE /api/admin/categories[/id]`
- [x] `POST/PATCH/DELETE /api/admin/coupons[/id]`
- [x] `PATCH/DELETE /api/admin/comments/[id]`
- [x] `PATCH /api/admin/orders/[id]/status`

---

## What Remains (Planned / Not Yet Built)

- [ ] **Customer order history** — `/[locale]/orders` page listing the logged-in user's past orders with statuses
- [ ] **Wishlist page** — `/[locale]/wishlist` displaying saved products (schema table exists: `wishlists`)
- [ ] **Product review submission** — form on product detail page for logged-in users to leave comments
- [ ] **PWA manifest** — `manifest.json` + service worker for "Add to Home Screen" on mobile
- [ ] **SEO** — `generateMetadata` on all pages (partially done on product/category detail pages)
- [ ] **Admin user management** — page to promote/demote users between customer/admin roles
- [ ] **Product SKU field** in admin product form (currently not shown, but required by DB schema)
- [ ] **Evolution API activation** — currently console-fallback; enable by setting `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` secrets

---

## Gotchas & Constraints

- **Run schema first**: `supabase/schema.sql` must be executed in Supabase SQL Editor before anything works
- **middleware.ts at artifact root**: Next.js requires `artifacts/store/middleware.ts` — not inside `src/`
- **No BASE_PATH**: The store artifact serves at `/` and Next.js handles all routing internally
- **`audit_log` not `audit_logs`**: Table is singular; columns are `actor_id`, `entity`, `entity_id`, `changes`
- **`product_categories`**: Junction table — not typed in `database.ts`, always use `(admin as any)` for these queries
- **Supabase `createAdminClient` uses service role key** — never expose this to the browser; only call from Server Components or API routes
- **`createSession` not in Supabase types**: Use `(supabase.auth.admin as any).createSession(...)` in OTP verify route
- **Tailwind v4**: Uses `@import "tailwindcss"` syntax in globals.css — no `tailwind.config.js`
- **shadcn/ui**: Components are in `src/components/ui/` — do not delete, many admin components depend on them
- **TypeScript pre-existing errors**: `src/components/ui/chart.tsx`, `src/lib/auth/otp.ts`, `src/lib/supabase/middleware.ts`, `src/lib/supabase/server.ts` have known implicit-any errors from library types — these are acceptable and must not be introduced as new errors

---

## User Preferences

- Stack: Next.js 15, Supabase, next-intl, Tailwind v4, shadcn/ui — do not swap libraries
- Evolution API skipped for now (console fallback active)
- Currency: AZN only, COD payments — no card payment integration
- Locales: az (default), ru, en — do not add more without being asked
- Admin panel: English-only, dark Space Slate-Blue theme
- TypeScript: use `as any` casts for Supabase join queries rather than adding Relationships to database.ts
