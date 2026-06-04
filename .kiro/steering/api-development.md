---
inclusion: fileMatch
fileMatchPattern: "**/api-server/**"
---

# API Server Development Guide

## Structure

```
artifacts/api-server/src/
├── app.ts              # Express app setup (cors, json, pino, router)
├── index.ts            # Server entry point (listen on PORT)
├── lib/
│   ├── logger.ts       # Pino logger instance
│   ├── supabase.ts     # Supabase client (service role)
│   ├── otp.ts          # OTP generation/verification
│   ├── notifications.ts # Notification queue helpers
│   └── whatsapp.ts     # WhatsApp API integration
├── middlewares/        # Express middlewares
└── routes/             # One file per domain
    ├── index.ts        # Route aggregator
    ├── auth.ts         # Phone OTP auth
    ├── products.ts     # Product CRUD + search
    ├── categories.ts   # Category management
    ├── orders.ts       # Order lifecycle
    ├── cart.ts         # Cart operations
    ├── coupons.ts      # Coupon validation
    ├── wishlist.ts     # Wishlist CRUD
    ├── comments.ts     # Review system
    ├── banners.ts      # Banner management
    ├── admin.ts        # Admin-specific ops
    ├── profile.ts      # User profile
    ├── bootstrap.ts    # Initial setup
    ├── health.ts       # Health check
    ├── migration.ts    # DB migrations
    └── dev.ts          # Dev-only routes (disabled in prod)
```

## Adding a New Route

1. Create `artifacts/api-server/src/routes/{domain}.ts`
2. Export a Router: `const router = Router(); export default router;`
3. Register in `artifacts/api-server/src/routes/index.ts`: `router.use({domain}Router);`
4. All routes are prefixed with `/api` (set in `app.ts`)

## Auth Pattern

```typescript
import { createClient } from "@supabase/supabase-js";

// Service role client (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Verify user token in route handler:
const token = req.headers.authorization?.replace("Bearer ", "");
const { data: { user }, error } = await supabase.auth.getUser(token);
if (!user) return res.status(401).json({ error: "Unauthorized" });
```

## Response Format

```typescript
// Success
res.json({ data: result });

// Error
res.status(400).json({ error: "Description of what went wrong" });

// List with pagination
res.json({ data: items, total: count, page, pageSize });
```

## Important Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/otp/request` | Send OTP code via WhatsApp |
| `POST` | `/api/auth/otp/verify` | Verify OTP and issue session |
| `POST` | `/api/orders` | Create order (validates products, prices, stock server-side) |
| `POST` | `/api/coupons/validate` | Validate coupon code (returns 400 for invalid, not 404) |
| `POST` | `/api/products/prices` | Bulk price check — accepts `{ product_ids: string[] }`, returns `{ [id]: { price, stock, slug } }` |
| `GET` | `/api/products/:id/specs` | Product specifications |
| `GET` | `/api/products/:id/related` | Related products |
| `GET` | `/api/profile/orders` | User's orders (auth required) |
| `POST` | `/api/cart/merge` | Merge guest cart into user cart after login |

## Build

The API server is bundled with esbuild to `dist/index.mjs`. Build config is in `build.mjs`.
