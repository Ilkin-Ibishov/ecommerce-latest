# Implementation Plan: Security Hardening

## Overview

Remediate 7 security findings (3 P0, 4 P1) from the security audit. Each task is a self-contained fix that touches one concern.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "3", "4"] },
    { "id": 1, "tasks": ["5"] },
    { "id": 2, "tasks": ["6", "7", "8"] },
    { "id": 3, "tasks": ["9"] }
  ]
}
```

## Tasks

- [x] 1. SEC-001: Add order quantity validation (P0)
  - Add `OrderBodySchema` to `artifacts/api-server/src/routes/admin/schemas.ts`:
    - `OrderItemSchema`: `product_id` (z.string().uuid()), `quantity` (z.number().int().min(1).max(99))
    - `OrderBodySchema`: `items` (z.array(OrderItemSchema).min(1).max(50)), `customer_name` (z.string().min(1).max(200)), `customer_phone` (z.string().min(1).max(30)), `delivery_address` (z.string().min(1).max(500)), `notes` (z.string().max(1000).nullable().optional()), `coupon_code` (z.string().max(50).optional())
  - Wire `validate(OrderBodySchema)` in POST /api/orders route chain in `routes/orders.ts` after `requireUser`, before the async handler
  - Remove the manual `if (!items?.length || !customer_name || ...)` check (Zod handles it now)
  - Run typecheck to verify
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. SEC-002: Remove platform secret from client bundle (P0)
  - In `artifacts/api-server/src/routes/platform.ts`, add a `GET /platform/notifications` handler:
    - Middleware: `requireUser`
    - Read `STORE_PLATFORM_SECRET` from `process.env` (NOT `VITE_` prefixed)
    - If missing, return 503 `{ error: "Service unavailable" }`
    - Forward to `${process.env.PLATFORM_CONTROL_PLANE_URL}/api/store-feed` with `Authorization: Bearer ${secret}`
    - Return upstream JSON on success; return upstream status on failure
  - In `artifacts/store/src/pages/admin/NotificationCenterPage.tsx`:
    - Replace `getNotificationsUrl()` to return `apiUrl("/platform/notifications")` (using the existing `apiUrl` helper)
    - Remove `getStoreCredential()` function and all `VITE_STORE_PLATFORM_SECRET` references
    - Remove `VITE_STORE_ID` header usage (server proxy doesn't need it — it owns the credential)
    - Keep `requireUser` auth — the proxy handles platform auth server-side
  - Run typecheck to verify
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. SEC-003: Bootstrap endpoint fail-closed guard (P0)
  - In `artifacts/api-server/src/routes/bootstrap.ts`, modify `POST /bootstrap/admin`:
    - Add as FIRST check: `if (!bootstrapSecret) { res.status(403).json({ error: "Forbidden" }); return; }`
    - Replace current comparison with constant-time: `import { timingSafeEqual } from "crypto"`
    - Length-safe comparison: if lengths differ OR `!timingSafeEqual(Buffer.from(bootstrapSecret), Buffer.from(secret ?? ""))`, return 403
    - Both missing-secret and wrong-secret return identical `{ error: "Forbidden" }` (no enumeration)
  - Run typecheck to verify
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. SEC-004: Update vulnerable dependencies (P1)
  - Update in `artifacts/api-server/package.json`: multer ≥2.2.0, vitest ≥3.2.6, undici ≥7.28.0
  - Update in `artifacts/store/package.json`: vite ≥7.3.5
  - Run `pnpm install` to update lockfile
  - Run `pnpm audit` and verify zero critical/high findings
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. Checkpoint - Verify P0 fixes and dep updates
  - Run `pnpm run typecheck`
  - Run `pnpm run build`
  - Run `pnpm exec vitest --run --project api-unit`
  - Run `pnpm exec vitest --run --project store-unit`
  - Ensure all tests pass, ask the user if questions arise

- [x] 6. SEC-005: Fix stock TOCTOU race — decrement before order insert (P1)
  - In `artifacts/api-server/src/routes/orders.ts`, restructure the POST /orders handler:
    - After product lookup and subtotal calculation, BEFORE inserting the order:
    - Create tracker: `const decremented: { productId: string; qty: number }[] = []`
    - Loop items, call `decrementStockSafe(admin, item.product_id, item.quantity)` for each
    - On decrement failure at item k: loop `decremented` array calling `incrementStock(admin, d.productId, d.qty)` (log failures, don't throw), return 409 `{ error: "Out of stock", product_id }`
    - After ALL decrements succeed: insert order + order_items
    - On order insert failure: loop ALL `decremented` calling `incrementStock`, let error propagate to errorHandler (500)
    - Remove the old post-insert stock decrement logic and the order-delete rollback pattern
  - Run typecheck and existing tests to verify
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. SEC-006: Fix coupon per-user check ordering (P1)
  - In `artifacts/api-server/src/routes/orders.ts`, restructure the coupon section:
    - AFTER coupon validation (active, not expired, within max_uses):
    - IF `couponData.max_uses_per_user` is set:
      - Query `coupon_usages` count for this user+coupon BEFORE incrementing
      - If count ≥ `max_uses_per_user`, return 400 `{ error: "Coupon usage limit reached for your account" }` (no side effects)
    - THEN increment global `used_count` with conditional guard `.lt("used_count", max_uses ?? 999999)`
    - If increment fails (race): return 400 `{ error: "Coupon usage limit exceeded" }`
    - THEN insert `coupon_usages` record with order_id
    - Remove the old post-increment per-user check + rollback pattern
  - Run typecheck to verify
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 8. SEC-007: Add magic byte validation to product upload (P1)
  - In `artifacts/api-server/src/routes/admin/products.ts`, modify `POST /admin/upload`:
    - Import `detectMimeType` from `../../lib/asset-uploader`
    - After `if (!file)` check, add: `const detected = detectMimeType(file.buffer)`
    - If `detected` is null: `res.status(415).json({ error: "File type not supported. Accepted: JPEG, PNG, WebP, AVIF" }); return;`
    - Replace `const ext = (file.originalname.split(".").pop() ?? "jpg").toLowerCase()` with `const ext = detected.ext`
    - Use `detected.mime` as contentType in the storage upload call
    - Remove the old `ALLOWED_EXTS` extension check (magic bytes supersede it)
  - Run typecheck to verify
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 9. Final checkpoint - Full verification
  - Run `pnpm run typecheck`
  - Run `pnpm run build`
  - Run `pnpm exec vitest --run --project api-unit`
  - Run `pnpm exec vitest --run --project store-unit`
  - Run `pnpm audit` — verify zero critical/high
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Each task is self-contained — one security finding per task
- Wave 0 runs 4 independent fixes in parallel (P0 items + dep update)
- Wave 1 gates with a checkpoint before the more complex P1 race condition fixes
- Wave 2 runs the 3 remaining P1 fixes (can be parallelized)
- Wave 3 is the final verification checkpoint
- All fixes use existing project patterns (validate middleware, RPC wrappers, detectMimeType)
- Run API tests: `pnpm exec vitest --run --project api-unit`
- Run store tests: `pnpm exec vitest --run --project store-unit`
