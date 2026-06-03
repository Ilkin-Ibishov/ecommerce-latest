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
| `products` | Product catalog (price, stock, flags) |
| `product_translations` | Localized title/description (az, ru, en) |
| `product_images` | Product image URLs with sort order |
| `product_categories` | Many-to-many product↔category |
| `categories` | Hierarchical categories (parent_id) |
| `category_translations` | Localized category names |
| `orders` | Order header (status, totals, address) |
| `order_items` | Line items with price snapshots |
| `cart_items` | Cart (user-based or session-based) |
| `coupons` | Discount codes (percentage/fixed, scoped) |
| `coupon_usages` | Track per-user coupon usage |
| `wishlists` | User wishlists |
| `comments` | Product reviews (admin-moderated) |
| `notifications` | WhatsApp/notification queue |
| `audit_log` | Admin action audit trail |
| `otp_requests` | OTP rate limiting (hashed codes) |

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
- Stock changes MUST use RPC: `decrement_stock_safe()` / `increment_stock()`
- Search uses `tsvector` with `'simple'` config + `unaccent`
- `updated_at` is auto-managed by triggers
