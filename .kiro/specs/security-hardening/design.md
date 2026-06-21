# Design Document: Security Hardening

## Overview

This design addresses 7 security findings (3 P0, 4 P1) identified in the White-Label E-Commerce platform. The fixes span input validation, secret management, access control, dependency vulnerabilities, race conditions in order/coupon flows, and file upload validation. All changes target the Express 5 API server (`@workspace/api-server`) and the React SPA (`@workspace/store`).

## Architecture

The security fixes are isolated, targeted patches to existing modules rather than new subsystems. Each fix modifies a single concern within its existing file or adds a small new route.

```
artifacts/api-server/src/
├── routes/
│   ├── orders.ts          ← SEC-001 (Zod schema), SEC-005 (stock-first), SEC-006 (coupon reorder)
│   ├── bootstrap.ts       ← SEC-003 (fail-closed guard)
│   ├── platform.ts        ← SEC-002 (notification proxy) [existing file, add route]
│   └── admin/
│       ├── products.ts    ← SEC-007 (magic byte validation)
│       └── schemas.ts     ← SEC-001 (OrderItemSchema co-located here)
├── middlewares/
│   └── validate.ts        ← unchanged (reused by SEC-001)
└── lib/
    ├── rpc.ts             ← unchanged (reused by SEC-005)
    └── asset-uploader.ts  ← unchanged (detectMimeType reused by SEC-007)
```

## Components and Interfaces

### SEC-001: Order Quantity Validation Schema

**Decision:** Define `OrderBodySchema` in `routes/admin/schemas.ts` alongside existing product/coupon/banner schemas. This file is already the home for route-level Zod schemas. The order route imports it and wires `validate(OrderBodySchema)` as middleware.

```typescript
// routes/admin/schemas.ts (addition)
import { z } from "zod";

const OrderItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

export const OrderBodySchema = z.object({
  items: z.array(OrderItemSchema).min(1).max(50),
  customer_name: z.string().min(1).max(200),
  customer_phone: z.string().min(1).max(30),
  delivery_address: z.string().min(1).max(500),
  notes: z.string().max(1000).nullable().optional(),
  coupon_code: z.string().max(50).optional(),
});
```

The `validate(OrderBodySchema)` middleware is inserted in the route chain after `requireUser` and before the async handler. On failure, it returns HTTP 400 with a Zod error message — no database calls occur.

### SEC-002: Notification Proxy Route

**Decision:** Add a `GET /api/platform/notifications` handler to the existing `routes/platform.ts` file. This keeps platform-related routes together.

```typescript
// routes/platform.ts (addition)
import { requireUser } from "../middlewares/requireUser";

router.get("/platform/notifications", requireUser, async (req, res): Promise<void> => {
  const secret = process.env.STORE_PLATFORM_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Service unavailable" });
    return;
  }

  const response = await fetch(
    `${process.env.PLATFORM_CONTROL_PLANE_URL}/api/store-feed`,
    {
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    res.status(response.status).json({ error: "Upstream error" });
    return;
  }

  const data = await response.json();
  res.json(data);
});
```

**Auth forwarding:** The proxy uses `requireUser` to authenticate the calling user via their Supabase JWT. It then forwards to the control-plane using the server-side `STORE_PLATFORM_SECRET` — the user's identity is not forwarded upstream (the control plane trusts the store's secret).

**Fail-closed:** If `STORE_PLATFORM_SECRET` is not set, return 503 immediately. No attempt to reach the control plane.

### SEC-003: Bootstrap Endpoint Fail-Closed

**Decision:** Fail at request time (not at startup). The bootstrap endpoint is rarely used and blocking server startup for a missing optional secret would break development environments where bootstrap isn't needed.

The guard is the first check in the handler, before any database call:

```typescript
// routes/bootstrap.ts — modified POST /bootstrap/admin handler
router.post("/bootstrap/admin", async (req, res): Promise<void> => {
  const bootstrapSecret = process.env.BOOTSTRAP_SECRET;

  // Fail-closed: if secret is not configured, reject all attempts
  if (!bootstrapSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { secret } = req.body as { secret?: string };

  // Constant-time comparison to prevent timing attacks
  const secretBuffer = Buffer.from(bootstrapSecret, "utf8");
  const providedBuffer = Buffer.from(secret ?? "", "utf8");

  if (
    secretBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(secretBuffer, providedBuffer)
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // ... existing logic continues
});
```

### SEC-005: Stock-First Order Creation

**Decision:** Decrement all stock first → insert order → on any failure, increment all decremented items back.

Sequence:

1. Validate request (Zod schema — SEC-001)
2. Fetch products, compute subtotals
3. **Decrement stock for ALL items** via `decrementStockSafe` (loop)
   - On failure at item N: call `incrementStock` for items 0..N-1, return HTTP 409
4. Insert order record + order items
   - On failure: call `incrementStock` for ALL items, return HTTP 500
5. Apply coupon (if any) — SEC-006 ordering
6. Return 201

**Partial decrement handling:** Track which items have been successfully decremented in an array. If decrement fails at index `k`, iterate the array `[0..k-1]` and call `incrementStock` for each. The rollback is best-effort — if a rollback call fails, log the error but still return 409 to the client (stock will be slightly over-reserved until manual correction, which is safer than over-selling).

```typescript
const decremented: { productId: string; qty: number }[] = [];

for (const item of validatedItems) {
  const { error } = await decrementStockSafe(admin, item.product_id, item.quantity);
  if (error) {
    // Roll back all previous decrements
    for (const d of decremented) {
      await incrementStock(admin, d.productId, d.qty).catch((e) =>
        req.log.error({ error: e, productId: d.productId }, "Stock rollback failed")
      );
    }
    res.status(409).json({ error: "Out of stock", product_id: item.product_id });
    return;
  }
  decremented.push({ productId: item.product_id, qty: item.quantity });
}
```

### SEC-006: Coupon Per-User Check Reordering

**Decision:** Move the per-user usage check BEFORE the `used_count` increment. Current code increments first, then checks per-user and rolls back on violation — this creates a window where concurrent requests from the same user can both pass the per-user check.

New ordering:

1. Validate coupon (active, not expired, within global max_uses)
2. **Check per-user usage count** (SELECT count from `coupon_usages`)
3. If per-user limit exceeded → reject with 400, no side effects
4. **Increment global `used_count`** with conditional guard (`used_count < max_uses`)
5. If global increment fails (race) → reject with 400
6. Insert `coupon_usages` record

```typescript
// SEC-006: Per-user check BEFORE global increment
if (couponData.max_uses_per_user) {
  const { count } = await admin
    .from("coupon_usages")
    .select("*", { count: "exact", head: true })
    .eq("coupon_id", couponData.id)
    .eq("user_id", user.id);

  if ((count ?? 0) >= couponData.max_uses_per_user) {
    res.status(400).json({ error: "Coupon usage limit reached for your account" });
    return;
  }
}

// Only now increment global used_count
const { data: updated } = await admin
  .from("coupons")
  .update({ used_count: (couponData.used_count ?? 0) + 1 })
  .eq("id", couponId)
  .lt("used_count", couponData.max_uses ?? 999999)
  .select("id");

if (!updated || updated.length === 0) {
  res.status(400).json({ error: "Coupon usage limit exceeded" });
  return;
}

// Record per-user usage
await admin.from("coupon_usages").insert({
  coupon_id: couponId,
  user_id: user.id,
  order_id: order.id,
});
```

### SEC-007: Magic Byte Validation in Upload Handler

**Decision:** Add `detectMimeType()` call in the existing `POST /admin/upload` handler in `routes/admin/products.ts`. This replaces the extension-based check with magic-byte detection.

```typescript
import { detectMimeType } from "../../lib/asset-uploader";

router.post("/admin/upload", requireAdmin, upload.single("file"), async (req: any, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  // SEC-007: Validate by magic bytes, not client-provided extension
  const detected = detectMimeType(file.buffer);
  if (!detected) {
    res.status(415).json({ error: "File type not supported. Accepted: JPEG, PNG, WebP, AVIF" });
    return;
  }

  // Use detected extension for storage filename
  const ext = detected.ext;
  const admin = getAdminSupabase();
  await ensureBucket(admin);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await admin.storage.from(BUCKET).upload(fileName, file.buffer, {
    contentType: detected.mime,
    upsert: false,
  });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(fileName);
  res.json({ url: publicUrl });
});
```

## Data Models

No new database tables or columns are introduced. The fixes operate on existing tables:

- `products` — stock field (atomic RPC operations)
- `orders` / `order_items` — unchanged schema, changed insertion ordering
- `coupons` — `used_count` field (conditional update)
- `coupon_usages` — existing junction table (read before write now)

### Interfaces

#### New Endpoint

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/platform/notifications` | `requireUser` | Proxy to control-plane store-feed |

#### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/api/orders` | Added Zod validation middleware; reordered stock/coupon logic |
| `POST` | `/bootstrap/admin` | Added fail-closed guard on missing secret |
| `POST` | `/admin/upload` | Magic-byte validation replaces extension check |

## Error Handling

| Scenario | HTTP Status | Error Shape |
|----------|-------------|-------------|
| Invalid order quantity (Zod) | 400 | `{ error: "<Zod message>" }` |
| Missing BOOTSTRAP_SECRET | 403 | `{ error: "Forbidden" }` |
| Wrong bootstrap secret | 403 | `{ error: "Forbidden" }` |
| Missing STORE_PLATFORM_SECRET | 503 | `{ error: "Service unavailable" }` |
| Upstream proxy failure | Forwarded status | `{ error: "Upstream error" }` |
| Out of stock (race) | 409 | `{ error: "Out of stock", product_id }` |
| Per-user coupon limit | 400 | `{ error: "Coupon usage limit reached for your account" }` |
| Global coupon limit (race) | 400 | `{ error: "Coupon usage limit exceeded" }` |
| Unsupported file type | 415 | `{ error: "File type not supported..." }` |
| Order insert fails post-decrement | 500 | `{ error: "Internal server error" }` (via errorHandler) |

## Testing Strategy

### Unit Tests (Example-Based)

- **SEC-002:** Verify the proxy route returns 503 when `STORE_PLATFORM_SECRET` is unset; verify it forwards with correct headers when set; verify unauthenticated requests get 401
- **SEC-003:** Verify constant-time comparison is used (import check); verify matching secret allows through
- **SEC-004:** Verify `pnpm audit` produces zero critical/high findings (smoke test in CI)
- **SEC-006:** Verify the correct ordering: per-user check → global increment → usage insert (mock-based sequence verification)

### Property Tests (Universal)

- **SEC-001:** Generate random quantities (negatives, zero, fractional, >99, valid 1-99) and verify schema acceptance/rejection
- **SEC-003:** Generate random request bodies with/without matching secrets and verify 403 on all invalid cases
- **SEC-005:** Generate random order item lists with configurable failure points and verify rollback completeness
- **SEC-006:** Generate random coupon states (at-limit, below-limit) and verify used_count is never modified when per-user limit is reached
- **SEC-007:** Generate random byte buffers (valid image headers, garbage, truncated) and verify detection/rejection

### Integration Tests

- **SEC-005:** End-to-end order creation with concurrent requests to verify no overselling

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Quantity validation rejects invalid inputs

*For any* order request body where any item has a quantity that is not a positive integer between 1 and 99 inclusive (negative, zero, fractional, >99, or non-numeric), the Order_Service SHALL return HTTP 400 without performing any database operation.

**Validates: Requirements 1.1, 1.2**

### Property 2: Quantity validation passes valid inputs unchanged

*For any* order request body where all items have integer quantities between 1 and 99 inclusive, the validated body SHALL contain the exact same integer values as the input (no coercion, no truncation).

**Validates: Requirements 1.1, 1.3**

### Property 3: Bootstrap fail-closed on missing secret

*For any* request body sent to `POST /bootstrap/admin` when `BOOTSTRAP_SECRET` is not set or empty, the endpoint SHALL return HTTP 403 regardless of the request content.

**Validates: Requirements 3.1**

### Property 4: Bootstrap rejects non-matching secrets

*For any* request body where the `secret` field does not exactly match the configured `BOOTSTRAP_SECRET` (including empty, null, or random strings), the endpoint SHALL return HTTP 403.

**Validates: Requirements 3.2, 3.3**

### Property 5: Stock decrement rollback on partial failure

*For any* order with N items where the k-th stock decrement fails (1 ≤ k ≤ N), all previously decremented items (1 through k-1) SHALL have their stock restored via IncrementStock_RPC, and the response SHALL be HTTP 409.

**Validates: Requirements 5.1, 5.2**

### Property 6: Stock decrement rollback on order insert failure

*For any* order where all N stock decrements succeed but the order INSERT fails, all N items SHALL have their stock restored via IncrementStock_RPC, and the response SHALL be HTTP 500.

**Validates: Requirements 5.4**

### Property 7: Per-user coupon check prevents used_count modification

*For any* coupon with `max_uses_per_user` set, if the requesting user's usage count in `coupon_usages` is ≥ `max_uses_per_user`, the Order_Service SHALL return HTTP 400 and the coupon's `used_count` SHALL remain unchanged.

**Validates: Requirements 6.1, 6.2**

### Property 8: Magic byte detection determines upload acceptance

*For any* file buffer uploaded to `POST /admin/upload`, if `detectMimeType(buffer)` returns null, the response SHALL be HTTP 415. If it returns a valid detection, the stored filename SHALL use the detected extension (not the client-provided extension).

**Validates: Requirements 7.1, 7.2, 7.4**
