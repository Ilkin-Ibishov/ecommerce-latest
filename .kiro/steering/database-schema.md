---
inclusion: fileMatch
fileMatchPattern: "**/{schema,migration,supabase,db,drizzle}*"
---

# Database Schema Reference

The canonical schema lives in `supabase/schema.sql`. Reference it via:
#[[file:supabase/schema.sql]]

## Key Tables

| Table | Purpose |
|-------|---------|
| `users` | User profiles (linked to Supabase Auth) |
| `products` | Product catalog (price, stock, brand, flags) |
| `product_translations` | Localized title/description (az, ru, en) |
| `product_images` | Product image URLs with sort order |
| `product_specs` | Product specifications (key/value pairs with sort order) |
| `categories` | Hierarchical categories (parent_id, slug, icon_url) |
| `category_translations` | Localized category names |
| `orders` | Order header (status, totals, address, coupon) |
| `order_items` | Line items with price/title snapshots |
| `cart_items` | Cart (user-based or session-based) |
| `coupons` | Discount codes (percentage/fixed, scoped, min order, max uses, expiry) |
| `coupon_usages` | Track per-user coupon usage |
| `wishlists` | User wishlists |
| `comments` | Product reviews with ratings (admin-moderated) |
| `notifications` | WhatsApp/notification queue (pending/sent/failed) |
| `audit_log` | Admin action audit trail |
| `pages` | CMS pages (slug, published, header/footer nav, sort order) |
| `page_translations` | Localized page content (title, content, SEO meta) |
| `site_settings` | White-label config (colors, fonts, logo, contact) |
| `product_categories` | Many-to-many junction (product_id, category_id) |
| `otp_requests` | OTP rate limiting (hashed codes, expiry) |
| `banners` | Homepage banners (title, image, CTA, sort order) |

## Order Status Flow

```
pending → phone_verified → courier_assigned → shipped → delivered
                                                      → refused_at_delivery
         → cancelled (from any state)
```

## Important Conventions

- All IDs are UUID (`gen_random_uuid()`)
- All tables have RLS enabled
- Translations use `lang_code IN ('az', 'ru', 'en')`
- Stock changes MUST use RPC: `decrement_stock_safe()` / `increment_stock()` (via the typed wrappers in `api-server/src/lib/rpc.ts`)
- Search uses `tsvector` with `'simple'` config + `unaccent`
- `updated_at` is auto-managed by triggers

## Typed access

The Supabase `Database` type (and the `Tables<"...">` row helper) is generated into the
`@workspace/supabase-types` package (`artifacts/supabase-types/`). Both packages type their
Supabase clients as `SupabaseClient<Database>` and derive row types via `Tables<"products">` etc.
Regenerate after schema changes: `supabase gen types typescript ... > artifacts/supabase-types/src/database.types.ts`.
NOTE: the live DB is ahead of the checked-in `supabase/schema.sql` snapshot (e.g. `products.search_text`,
`product_specs`, `pages`/`page_translations`, `site_settings`, `banners`); the generated types reflect the live schema.
The Drizzle package `@workspace/db` is a SEPARATE thing — it does NOT export the Supabase `Database` type.
