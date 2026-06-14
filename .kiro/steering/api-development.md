---
inclusion: fileMatch
fileMatchPattern: "**/api-server/**"
---

# API Server Development Guide

## Structure

```
artifacts/api-server/src/
├── app.ts              # Express app setup (cors, json, pino, router, errorHandler LAST)
├── index.ts            # Server entry point (listen on PORT)
├── lib/
│   ├── logger.ts       # Pino logger instance
│   ├── supabase.ts     # Supabase clients (typed SupabaseClient<Database>) + legacy requireAdmin(req) resolver
│   ├── env.ts          # resolveSupabaseEnv(source) — VITE_*→non-prefixed precedence (mirrored in store)
│   ├── audit.ts        # writeAudit() — fire-and-forget audit_log writer
│   ├── rpc.ts          # typed RPC wrappers (decrementStockSafe/incrementStock/searchProducts)
│   ├── coupon-calc.ts  # calculateDiscount() — tested pure fn (rounding + min-order + subtotal cap)
│   ├── cart-merge.ts   # mergeGuestCart() — tested pure fn (caps every line at MAX_QUANTITY=99)
│   ├── otp.ts          # OTP generation/verification
│   ├── notifications.ts # Notification queue helpers
│   └── whatsapp.ts     # WhatsApp API integration
├── types/express.d.ts  # Express.Request augmentation: req.user/admin/authUser/validatedBody
├── middlewares/        # requireAdmin, requireUser, errorHandler, validate
└── routes/             # One file per domain
    ├── index.ts        # Route aggregator
    ├── auth.ts products.ts categories.ts orders.ts cart.ts coupons.ts ...
    └── admin/          # Admin ops split by domain (aggregated by admin/index.ts):
        └── index.ts products.ts banners.ts orders.ts categories.ts coupons.ts
            whatsapp.ts users.ts settings.ts comments.ts
```

## Adding a New Route

1. Create `artifacts/api-server/src/routes/{domain}.ts` (or `routes/admin/{domain}.ts` for admin ops)
2. Export a Router: `const router = Router(); export default router;`
3. Register in `routes/index.ts` (or `routes/admin/index.ts`): `router.use({domain}Router);`
4. All routes are prefixed with `/api` (set in `app.ts`)
5. **Route order matters:** register literal paths (e.g. `/admin/products/bulk-flag`, `/admin/products/bulk`) BEFORE `/:id` param routes, or `:id` will shadow them.

## Auth Pattern — use middleware, not inline checks

Auth is enforced by Express middleware attached per-route (NOT inline token parsing):

```typescript
import { requireAdmin } from "../middlewares/requireAdmin"; // 403 + req.admin (SupabaseClient<Database>) + req.user
import { requireUser } from "../middlewares/requireUser";   // 401 + req.authUser = { id }

router.post("/admin/products", requireAdmin, validate(CreateProductSchema), async (req, res) => {
  const admin = req.admin!;        // typed service-role client
  // ...
});

router.post("/orders", requireUser, async (req, res) => {
  const userId = req.authUser!.id;
  // ...
});
```

- `requireAdmin` → `403 { error: "Forbidden" }`; `requireUser` → `401 { error: "Unauthorized" }`.
- Validate admin write bodies with `validate(zodSchema)` (`middlewares/validate.ts`) → `400 { error }` on failure, attaches `req.validatedBody`.
- Audit admin mutations with `writeAudit({ admin, req, actorId, action, entityType, entityId?, details? })` — never inline `audit_log` inserts.
- Stock changes go through `decrementStockSafe`/`incrementStock` from `lib/rpc.ts`.

## Error Handling

`app.ts` registers a central `errorHandler` middleware AFTER the routes. Express 5 auto-forwards rejected async handlers to it, so **do not** wrap a handler in try/catch just to return a generic 500 — let it throw. Keep explicit non-500 returns (400/401/403/404/409) inline. The handler logs `err.message`/`err.stack` via `req.log` and returns only `{ error: "Internal server error" }` (never leaks detail).

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
