# Security Audit Report — White-Label E-Commerce Platform

**Date:** 2025-07-17  
**Auditor:** Automated Red Team Security Review  
**Scope:** Full-stack code review (static analysis) of the pnpm monorepo  
**Classification:** CONFIDENTIAL — For project owners only

---

## 1. Executive Summary

### Overall Security Posture: **FAIR**

The application demonstrates solid engineering fundamentals with centralized auth middleware, input validation via Zod, proper error handling that never leaks internals, and atomic stock operations via RPC. However, several **critical and high-severity issues** require immediate attention before production hardening.

### Finding Counts

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 5 |
| Low | 4 |
| Informational | 3 |
| **Total** | **19** |

### Top 5 Risks Requiring Immediate Attention

1. **SEC-001** — Service role keys and secrets committed in `.env` (tracked by git in working tree)
2. **SEC-002** — OTP test bypass code active in production (`999999` always validates)
3. **SEC-003** — Wildcard CORS with no origin restriction (`cors()` with no config)
4. **SEC-004** — No API-level rate limiting on authentication, checkout, or admin routes
5. **SEC-005** — Coupon `used_count` increment is non-atomic (race condition enables reuse)

### Release Readiness

**NOT READY for production** without fixing P0 items. The `.env` secrets exposure and OTP bypass represent immediate exploitable vulnerabilities.

### Positive Security Controls (Already Working Well)

- ✅ Central `errorHandler` never leaks `err.message`/`err.stack` to clients
- ✅ `requireAdmin`/`requireUser` middleware enforced consistently on protected routes
- ✅ Stock changes use atomic RPC (`decrement_stock_safe`) with WHERE guard
- ✅ Prices are ALWAYS sourced server-side from DB during order creation — never from client
- ✅ OTP codes are hashed (SHA-256) before storage
- ✅ File uploads have extension whitelist and size limits (multer + asset-uploader)
- ✅ HTML content is sanitized via `sanitize-html` for CMS pages
- ✅ Super-admin auth uses MFA + session validation (lifetime + idle checks)
- ✅ `requireServiceCredential` uses constant-time comparison
- ✅ Dev routes are gated by `NODE_ENV !== "production"` check
- ✅ Audit logging on all admin mutations via `writeAudit()`

---

## 2. Application Map

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 SPA, Vite 7, Tailwind v4, wouter |
| Backend | Express 5, TypeScript strict, Node 22 |
| Database | Supabase (PostgreSQL) with RLS |
| Auth | Supabase Auth + Custom OTP (WhatsApp) |
| Storage | Supabase Storage (product images) |
| Deployment | Vercel (frontend) + Railway (API server) |
| Monorepo | pnpm workspaces |

### User Roles & Privilege Hierarchy

```
Super Admin (Platform)  →  requireSuperAdmin + MFA + session
    ↓
Store Admin             →  requireAdmin (role='admin' in users table)
    ↓
Authenticated Customer  →  requireUser (valid Supabase JWT)
    ↓
Guest (Unauthenticated) →  Public routes only
```

### Trust Boundaries

```
Browser (SPA)
    ↓ HTTPS (CORS: wildcard ⚠️)
API Server (Express 5, Railway)
    ↓ Service-role key
Supabase PostgreSQL (RLS enabled)
    ↓
Supabase Storage (product-images bucket, public)
    ↓
Control_Plane (separate Supabase project)
```

### API Route Map (Critical Endpoints)

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/auth/otp/request` | None | Send OTP via WhatsApp |
| `POST /api/auth/otp/verify` | None | Verify OTP, issue token |
| `POST /api/orders` | requireUser | Create order (checkout) |
| `POST /api/coupons/validate` | None | Validate coupon code |
| `POST /api/cart/merge` | requireUser | Merge guest cart |
| `POST /api/products/prices` | None (platformStatus) | Bulk price check |
| `GET /api/orders/:id` | requireUser | Get order (ownership check) |
| `PATCH /api/admin/users/:id/role` | requireAdmin | Change user role |
| `POST /api/admin/products` | requireAdmin + quota | Create product |
| `POST /api/admin/migrate` | requireAdmin | Run SQL migrations |
| `GET /api/store-metrics` | Store credential | Aggregates for Control_Plane |
| `POST /api/platform/auth/session` | Bearer + MFA | Super-admin session |
| `POST /api/platform/impersonation` | requireSuperAdmin | Read-only store access |

---

## 3. Threat Model (STRIDE)

| Asset / Flow | Threat | Attack Scenario | Impact | Existing Protection | Missing Protection | Risk | OWASP |
|---|---|---|---|---|---|---|---|
| OTP Auth | Spoofing | Use hardcoded test code `999999` on any phone | Full account takeover | Rate limiting on OTP request | Test bypass active in prod | **Critical** | A07 |
| Checkout | Tampering | Race condition on coupon usage → double discount | Financial loss | Coupon validation logic | Atomic usage increment | **High** | A04 |
| Admin access | Elevation | If any admin can promote any user to admin via PATCH /admin/users/:id/role | Privilege escalation | requireAdmin check | No super-admin distinction for role changes | **Medium** | A01 |
| Order access | Info Disclosure | IDOR on GET /orders/:id with role check fallback to users table | Cross-user data leak | ownership + role check | Role check uses service client (bypasses RLS) | **Low** | A01 |
| API endpoints | DoS | No rate limiting on login, checkout, search | Service degradation | OTP rate limit (custom) | Global API rate limiting | **High** | A05 |
| CORS | Spoofing | Wildcard CORS allows any origin to make authenticated requests | CSRF-like attacks | None | Origin whitelist | **High** | A05 |
| Coupon validate | Info Disclosure | Unauthenticated endpoint reveals coupon existence/details | Business intelligence leak | None | Auth or CAPTCHA | **Low** | A01 |
| File upload | Tampering | SVG files with embedded scripts (not in ALLOWED_EXTS but alt upload path) | Stored XSS | Extension whitelist, multer limits | Content-type validation on magic bytes | **Medium** | A03 |
| Migration endpoint | Elevation | Admin can execute arbitrary SQL schema changes | DB compromise | requireAdmin | Should require super-admin or be disabled in prod | **High** | A01 |
| Platform secrets | Info Disclosure | `.env` in working dir contains all service keys | Full infrastructure compromise | .gitignore excludes .env | .env present in working tree, env values in vercel.json | **Critical** | A02 |


---

## 4. Detailed Findings

---

### SEC-001: Service Role Keys and Secrets in Repository Working Tree

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **CVSS Score** | 9.8 |
| **OWASP Category** | A02 — Cryptographic Failures |
| **Affected Area** | `.env`, `vercel.json` |
| **Status** | Confirmed |

**Description:**
The `.env` file in the project root contains live Supabase service-role keys, Control_Plane service keys, UltraMsg tokens, and a `PLATFORM_SCHEDULER_SECRET`. While `.gitignore` excludes `.env`, the file is present in the working tree and `vercel.json` (which IS tracked) contains the Supabase anon keys and URL in the `build.env` section. The `SUPABASE_SERVICE_ROLE_KEY` grants full bypass of RLS policies.

**Evidence:**
- File: `.env` — contains `SUPABASE_SERVICE_ROLE_KEY` (eyJ...****Erc)
- File: `.env` — contains `CONTROL_PLANE_SUPABASE_SERVICE_KEY` (eyJ...****msU)
- File: `.env` — contains `PLATFORM_SCHEDULER_SECRET` (plaintext shared secret)
- File: `.env` — contains `ULTRAMSG_TOKEN` (t6gr...****amif)
- File: `vercel.json` — build env contains `VITE_SUPABASE_ANON_KEY` (anon keys are public by design, but coupling to tracked file is risky)

⚠️ Actual key values masked in this report.

**Risk:**
Anyone with repository read access can use the service-role key to bypass all RLS, read/write any data, create admin users, or delete the entire database. The Control_Plane key grants full platform-level access.

**Recommended Fix:**
1. Rotate ALL exposed keys immediately (Supabase dashboard → Settings → API)
2. Remove `PLATFORM_SCHEDULER_SECRET` from `.env` and use a secrets manager
3. Never commit `vercel.json` with real keys — use Vercel's environment variables UI
4. Add a pre-commit hook to scan for secrets (e.g., `gitleaks`, `trufflehog`)
5. Verify git history doesn't contain previously committed `.env` values

**Regression Test:**
- CI check: `gitleaks detect --source . --no-git` fails if secrets found in tracked files

---

### SEC-002: OTP Test Bypass Active in Production

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **CVSS Score** | 9.1 |
| **OWASP Category** | A07 — Identification & Authentication Failures |
| **Affected Area** | `artifacts/api-server/src/lib/otp.ts`, lines 83-88 |
| **Status** | Confirmed |

**Description:**
The `verifyOTP()` function contains a hardcoded test bypass: phone `+994551234567` with code `999999` always returns `{ valid: true }`. This bypass is NOT gated by `NODE_ENV` and executes in production. Additionally, `checkRateLimit()` always allows phone `+994551234567` regardless of environment.

**Evidence:**
```typescript
// otp.ts lines 83-88
const TEST_PHONE = "+994551234567";
const TEST_CODE = "999999";
if (phone === TEST_PHONE && code === TEST_CODE) {
  return { valid: true };
}
```

**Risk:**
An attacker who discovers this test phone (visible in source code) can authenticate as the user associated with `+994551234567` without any real OTP verification. If no account exists, the auth flow creates one. Combined with role promotion, this could lead to admin takeover.

**Recommended Fix:**
1. Remove the hardcoded test bypass entirely
2. For E2E testing, use the existing `devInjectOTP` mechanism (already gated by `NODE_ENV`)
3. If a test bypass is needed in staging, gate it with `if (IS_DEV)` like other dev paths

**Regression Test:**
- grep for `TEST_PHONE`, `TEST_CODE`, `999999` in production builds
- Unit test: verify `verifyOTP("+994551234567", "999999")` returns `{ valid: false }` when `NODE_ENV=production`

---

### SEC-003: Wildcard CORS Configuration

| Field | Value |
|-------|-------|
| **Severity** | High |
| **CVSS Score** | 7.5 |
| **OWASP Category** | A05 — Security Misconfiguration |
| **Affected Area** | `artifacts/api-server/src/app.ts`, line 29 |
| **Status** | Confirmed |

**Description:**
The Express app uses `cors()` with no configuration, which defaults to `Access-Control-Allow-Origin: *`. This allows any website to make cross-origin requests to the API. While the API uses Bearer tokens (not cookies), this still enables:
- Any malicious site to exfiltrate data if a user's token is leaked via XSS
- Credential-bearing requests from arbitrary origins if cookies are later added

**Evidence:**
```typescript
// app.ts line 29
app.use(cors());
```

**Risk:**
Combined with any XSS vulnerability in a third-party site that the user visits, an attacker could make authenticated API calls using a stolen token. For an ecommerce platform handling financial data, this is high risk.

**Recommended Fix:**
```typescript
app.use(cors({
  origin: [
    'https://your-store.vercel.app',
    'https://your-custom-domain.az',
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
  ],
  credentials: true,
}));
```

**Regression Test:**
- Integration test: verify `OPTIONS` request from unknown origin returns no `Access-Control-Allow-Origin` header

---

### SEC-004: No API-Level Rate Limiting on Critical Endpoints

| Field | Value |
|-------|-------|
| **Severity** | High |
| **CVSS Score** | 7.0 |
| **OWASP Category** | A05 — Security Misconfiguration |
| **Affected Area** | `artifacts/api-server/src/app.ts` (global), all routes |
| **Status** | Confirmed |

**Description:**
While OTP requests have custom per-phone rate limiting, there is NO global rate limiting middleware (e.g., `express-rate-limit`). Critical endpoints lack protection:
- `POST /api/auth/otp/verify` — brute-force OTP codes (6 digits = 1M combinations, max 5 attempts per OTP but can request new OTPs)
- `POST /api/orders` — automated order spam
- `POST /api/coupons/validate` — coupon code enumeration
- `GET /api/search/suggest` — search abuse
- All admin routes — no protection against compromised admin token abuse

**Evidence:**
No `express-rate-limit` or similar package in dependencies. No rate-limit middleware in app.ts or route files (except custom OTP logic).

**Risk:**
- OTP brute-force: Request OTP → try all 999999 codes (5 at a time, request new OTP, repeat) = practical bypass
- Order spam could deplete stock and create operational chaos
- Coupon enumeration reveals valid codes for social engineering

**Recommended Fix:**
```typescript
import rateLimit from 'express-rate-limit';

// Global: 100 req/min per IP
app.use(rateLimit({ windowMs: 60_000, max: 100 }));

// Strict: auth endpoints 5 req/min per IP  
authRouter.use(rateLimit({ windowMs: 60_000, max: 5 }));

// Orders: 10 req/min per IP
ordersRouter.use(rateLimit({ windowMs: 60_000, max: 10 }));
```

**Regression Test:**
- Load test: verify 429 returned after exceeding threshold

---

### SEC-005: Non-Atomic Coupon Usage Increment (Race Condition)

| Field | Value |
|-------|-------|
| **Severity** | High |
| **CVSS Score** | 7.5 |
| **OWASP Category** | A04 — Insecure Design |
| **Affected Area** | `artifacts/api-server/src/routes/orders.ts`, lines 95-100 |
| **Status** | Suspected (logic analysis) |

**Description:**
The order creation flow validates coupon usage limits via `coupon.used_count < coupon.max_uses`, then later increments `used_count` with a simple UPDATE. Between the check and the increment, concurrent requests can pass the validation simultaneously, exceeding `max_uses`.

**Evidence:**
```typescript
// Check (line ~70)
const withinMaxUses = !coupon.max_uses || coupon.used_count < coupon.max_uses;

// Later increment (line ~100) 
await admin.from("coupons").update({ used_count: (couponData.used_count ?? 0) + 1 }).eq("id", couponId);
```
The increment uses the stale `couponData.used_count` value read earlier, not `used_count + 1` from the DB.

**Risk:**
A customer could submit multiple orders simultaneously with the same coupon, all passing the max_uses check. For a coupon with `max_uses: 1`, this could result in 5-10 uses before the counter catches up. Financial loss = discount_value × extra uses.

**Recommended Fix:**
Use a conditional update or database-level atomic increment:
```typescript
// Atomic: only increment if still within limits
const { data, error } = await admin
  .from("coupons")
  .update({ used_count: couponData.used_count + 1 })
  .eq("id", couponId)
  .lt("used_count", coupon.max_uses) // Guard at DB level
  .select("id");

if (!data || data.length === 0) {
  // Race condition: coupon exceeded — rollback order or reject
}
```
Or use a Supabase RPC with `UPDATE ... SET used_count = used_count + 1 WHERE used_count < max_uses RETURNING id`.

**Regression Test:**
- Property test: 10 concurrent order submissions with `max_uses: 1` coupon → only 1 succeeds

---

### SEC-006: Admin Migration Endpoint Allows Arbitrary SQL Execution

| Field | Value |
|-------|-------|
| **Severity** | High |
| **CVSS Score** | 8.0 |
| **OWASP Category** | A01 — Broken Access Control |
| **Affected Area** | `artifacts/api-server/src/routes/migration.ts` |
| **Status** | Confirmed |

**Description:**
The `POST /api/admin/migrate` endpoint executes predefined SQL statements against the Supabase database using the service-role key. While the SQL is currently hardcoded (not user-supplied), the endpoint uses `runSql()` which sends raw SQL to Supabase's REST API. Any admin (not just super-admins) can trigger this. If the hardcoded SQL is ever parameterized or if the endpoint is extended, it becomes a full SQL injection vector.

**Evidence:**
```typescript
// migration.ts
router.post("/admin/migrate", requireAdmin, async (req, res) => { ... });
// Uses: fetch(endpoint, { body: JSON.stringify({ query: sql }) })
```

**Risk:**
- Any store admin can trigger schema migrations
- If SQL strings are ever derived from request body, this becomes RCE-equivalent
- Migration should be a deployment/CI task, not an API endpoint

**Recommended Fix:**
1. Remove this endpoint or gate it behind `requireSuperAdmin`
2. Run migrations via CI/CD pipeline (Supabase CLI `supabase db push`)
3. If kept, add a `MIGRATION_ENABLED` env flag that defaults to `false`

---

### SEC-007: Coupon Validation Endpoint Unauthenticated

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CVSS Score** | 5.0 |
| **OWASP Category** | A01 — Broken Access Control |
| **Affected Area** | `artifacts/api-server/src/routes/coupons.ts` |
| **Status** | Confirmed |

**Description:**
`POST /api/coupons/validate` requires no authentication. Any visitor can enumerate valid coupon codes and discover discount details (type, value, description). This leaks business-sensitive information.

**Evidence:**
```typescript
router.post("/coupons/validate", async (req, res) => { // No auth middleware
```

**Risk:**
- Coupon code enumeration (brute-force dictionary of likely codes)
- Competitors can discover active promotions and discount values
- Scrapers can aggregate all coupon data

**Recommended Fix:**
Add `requireUser` middleware, or add a CAPTCHA/proof-of-work, or rate-limit severely (3 req/min/IP).

---

### SEC-008: No Per-User Coupon Usage Enforcement at Order Time

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CVSS Score** | 5.5 |
| **OWASP Category** | A04 — Insecure Design |
| **Affected Area** | `artifacts/api-server/src/routes/orders.ts`, coupon validation block |
| **Status** | Confirmed |

**Description:**
The `coupons` table has a `max_uses_per_user` column, and the admin can set it when creating coupons. However, the order creation logic does NOT check `coupon_usages` to enforce per-user limits. It only checks global `used_count < max_uses`. A single user can use the same coupon on unlimited orders.

**Evidence:**
The order route checks:
- `coupon.max_uses` (global) ✅
- `coupon.expires_at` ✅
- `coupon.is_active` ✅
- Does NOT query `coupon_usages` for the current user's prior usage ❌

**Risk:**
A customer can repeatedly use a coupon that was intended for single-use-per-customer, getting unlimited discounts.

**Recommended Fix:**
Before applying the coupon in order creation:
```typescript
if (coupon.max_uses_per_user) {
  const { count } = await admin
    .from("coupon_usages")
    .select("*", { count: "exact", head: true })
    .eq("coupon_id", coupon.id)
    .eq("user_id", user.id);
  if ((count ?? 0) >= coupon.max_uses_per_user) {
    return res.status(400).json({ error: "Coupon usage limit reached for your account" });
  }
}
```

---

### SEC-009: Missing Security Response Headers

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CVSS Score** | 4.0 |
| **OWASP Category** | A05 — Security Misconfiguration |
| **Affected Area** | `artifacts/api-server/src/app.ts` |
| **Status** | Confirmed |

**Description:**
The API server does not set any security headers. The frontend (served by Vercel) may have some defaults, but the API responses lack: CSP, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy, Permissions-Policy.

**Recommended Fix:**
Add `helmet` middleware:
```typescript
import helmet from 'helmet';
app.use(helmet());
```

---

### SEC-010: Deterministic Session Password in OTP Auth Flow

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CVSS Score** | 6.0 |
| **OWASP Category** | A07 — Identification & Authentication Failures |
| **Affected Area** | `artifacts/api-server/src/routes/auth.ts`, lines 58-65 |
| **Status** | Confirmed |

**Description:**
The OTP verification flow creates a "temp" email/password for each user to issue Supabase tokens. The password is derived deterministically from the user ID: `pauth_${userId.replace(/-/g, "").slice(0, 24)}`. Anyone who knows a user's UUID can compute their password and call `signInWithPassword` directly.

**Evidence:**
```typescript
const tempEmail = `${phone.replace(/[^0-9]/g, "")}@phoneauth.internal`;
const tempPass  = `pauth_${userId.replace(/-/g, "").slice(0, 24)}`;
```

**Risk:**
If user UUIDs are exposed anywhere (order responses, admin panels, Supabase logs), an attacker can construct the email+password pair and authenticate as that user without any OTP. UUIDs are often considered semi-public.

**Recommended Fix:**
1. Use `admin.auth.admin.generateLink()` or a server-side token generation approach
2. If the workaround must stay, derive the password from `userId + a server-only secret` using HMAC:
```typescript
const tempPass = createHmac('sha256', process.env.SESSION_SECRET!)
  .update(userId).digest('hex').slice(0, 32);
```

---

### SEC-011: `NODE_ENV = production` Set in .env But Dev Routes Guard is Present

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CVSS Score** | 4.5 |
| **OWASP Category** | A05 — Security Misconfiguration |
| **Affected Area** | `artifacts/api-server/src/routes/index.ts`, `.env` |
| **Status** | Confirmed (guard works) |

**Description:**
The dev routes (`/api/dev/mock-otp`, `/api/dev/last-otp`) are gated by `process.env.NODE_ENV !== "production"`. The `.env` sets `NODE_ENV = production`. However, if the Railway deployment doesn't explicitly set `NODE_ENV=production` via its own env vars (and relies on the `.env` file not being deployed), the dev routes could be exposed. Additionally, `console.log` is used in the dev route handler.

**Risk:**
Low in current config, but fragile. If deployment misconfigures NODE_ENV, OTP codes become retrievable via API.

**Recommended Fix:**
Add defense-in-depth: also check for an explicit `ENABLE_DEV_ROUTES=true` flag, and never deploy the dev routes file in the production bundle.

---

### SEC-012: No Request Body Size Limit on Express JSON Parser

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CVSS Score** | 3.5 |
| **OWASP Category** | A05 — Security Misconfiguration |
| **Affected Area** | `artifacts/api-server/src/app.ts`, line 31 |
| **Status** | Confirmed |

**Description:**
`express.json()` is used without a `limit` option. Express defaults to 100KB, which is reasonable, but should be explicitly set. For endpoints that accept arrays (like `product_ids` in `/products/prices`), the 50-item limit is good but the overall payload size is unbounded by application code.

**Recommended Fix:**
```typescript
app.use(express.json({ limit: '100kb' }));
```

---

### SEC-013: Upload Route Order — `multer` Runs Before `requireAdmin`

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CVSS Score** | 3.0 |
| **OWASP Category** | A05 — Security Misconfiguration |
| **Affected Area** | `artifacts/api-server/src/routes/admin/products.ts`, line 25 |
| **Status** | Confirmed |

**Description:**
In the `/admin/upload` route, `multer` (file parsing) runs BEFORE `requireAdmin` (auth check):
```typescript
router.post("/admin/upload", upload.single("file"), requireAdmin, async (req, res) => { ...
```
This means unauthenticated users can upload file data into server memory before being rejected. An attacker could send large files to consume memory before the 403 response.

**Risk:**
Memory exhaustion DoS. Multer's 10MB limit helps, but an attacker can send many concurrent 10MB requests without authentication.

**Recommended Fix:**
Swap middleware order: `requireAdmin` first, then `upload.single("file")`.

---

### SEC-014: Admin Self-Demotion Check but No Super-Admin Distinction

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CVSS Score** | 3.5 |
| **OWASP Category** | A01 — Broken Access Control |
| **Affected Area** | `artifacts/api-server/src/routes/admin/users.ts` |
| **Status** | Confirmed |

**Description:**
Any admin can promote any customer to admin, or demote other admins to customer. There's no "super admin" gate on role changes at the store level. The self-demotion check prevents accidental lockout, but a rogue admin could promote an attacker's account and then have that account demote the original admin.

**Risk:**
If one admin account is compromised, the attacker can create persistence by promoting a controlled account and demoting other admins.

**Recommended Fix:**
Require a secondary confirmation (password re-entry) for role changes, or restrict role changes to the first/oldest admin.

---

### SEC-015: Vulnerable Dependencies

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CVSS Score** | 3.0 |
| **OWASP Category** | A06 — Vulnerable & Outdated Components |
| **Affected Area** | `pnpm-lock.yaml` |
| **Status** | Confirmed |

**Description:**
`pnpm audit` reports:
- **1 critical**: vitest < 3.2.6 (file read/execute when UI server listening) — dev dependency only
- **2 high**: esbuild < 0.28.1 (RCE via NPM_CONFIG_REGISTRY — build-time only), vite ≤ 6.4.2 / ≤ 7.3.4 (server.fs.deny bypass on Windows — dev only)
- **1 moderate**: qs 6.11.1–6.15.1 (DoS via comma-format arrays) — runtime dependency via Express

**Risk:**
The `qs` vulnerability is the only runtime concern. It requires specific query parameter formatting (`encodeValuesOnly` + null entries in comma arrays) which Express doesn't use by default.

**Recommended Fix:**
1. Update vitest to ≥ 3.2.6
2. Update esbuild to ≥ 0.28.1
3. Monitor qs for patch and update Express when available

---

### SEC-016: Order Stock Deduction Has Partial Failure Mode

| Field | Value |
|-------|-------|
| **Severity** | Informational |
| **CVSS Score** | N/A |
| **OWASP Category** | A04 — Insecure Design |
| **Affected Area** | `artifacts/api-server/src/routes/orders.ts`, stock deduction loop |
| **Status** | Suspected |

**Description:**
Stock deduction iterates over items sequentially. If the RPC call fails for item N, the fallback conditional UPDATE runs. If THAT fails (stock depleted), the order is deleted. However, items 1..N-1 already had their stock decremented. The "rollback" only deletes the order row — it does NOT re-increment stock for successfully decremented items.

**Risk:**
In a race condition scenario, stock can become permanently "lost" (decremented but order deleted). This is a data consistency issue rather than a security vulnerability.

**Recommended Fix:**
Wrap the entire stock deduction in a Supabase RPC transaction, or implement compensating stock increments on failure.

---

### SEC-017: `console.log` in Production Code Path

| Field | Value |
|-------|-------|
| **Severity** | Informational |
| **CVSS Score** | N/A |
| **OWASP Category** | A09 — Security Logging & Monitoring Failures |
| **Affected Area** | `artifacts/api-server/src/routes/dev.ts`, `artifacts/api-server/src/lib/otp.ts` |
| **Status** | Confirmed |

**Description:**
The dev route uses `console.log` for OTP codes. The `createOTP` function in dev mode also logs codes via `console.log`. While dev routes are gated, the pattern violates the project's logging standard (pino via `req.log`).

**Recommended Fix:**
Replace all `console.log` with structured logging via the pino `logger` singleton.

---

### SEC-018: `auth/signout` Endpoint Does Nothing Server-Side

| Field | Value |
|-------|-------|
| **Severity** | Informational |
| **CVSS Score** | N/A |
| **OWASP Category** | A07 — Identification & Authentication Failures |
| **Affected Area** | `artifacts/api-server/src/routes/auth.ts`, line 80 |
| **Status** | Confirmed |

**Description:**
```typescript
router.post("/auth/signout", (_req, res) => {
  return res.json({ success: true });
});
```
This endpoint performs no server-side token invalidation. Supabase JWTs remain valid until expiry. The client may remove the token locally, but the token can still be used by an attacker who intercepted it.

**Risk:**
Stolen tokens remain usable after "logout". For an ecommerce app, this means a session hijacker retains access even after the victim logs out.

**Recommended Fix:**
Call `supabase.auth.admin.signOut(token)` server-side or maintain a token blocklist until expiry.

---

### SEC-019: Product Price/Stock Validation Missing Upper Bounds

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CVSS Score** | 2.0 |
| **OWASP Category** | A04 — Insecure Design |
| **Affected Area** | `artifacts/api-server/src/routes/admin/schemas.ts` |
| **Status** | Confirmed |

**Description:**
The `CreateProductSchema` validates `price: z.number()` and `stock: z.number()` without bounds. An admin could set `price: -100` (negative) or `stock: 999999999` (absurd value). Negative prices combined with coupon discounts could result in negative totals.

**Recommended Fix:**
```typescript
price: z.number().min(0).max(9999999),
stock: z.number().int().min(0).max(999999),
```

---

## 5. Critical Ecommerce Abuse Cases

| Abuse Case | Possible? | Evidence | Severity |
|---|---|---|---|
| Customer modifies product price from frontend | **No** | Order creation fetches price from DB (`products.price`), not from request body | N/A — Well protected ✅ |
| Customer orders out-of-stock products | **No** | Stock check `product.stock < item.quantity` + atomic `decrement_stock_safe` with WHERE guard | N/A — Well protected ✅ |
| Customer accesses another customer's order | **Partial** | `GET /orders/:id` checks `order.user_id !== user.id`, but fallback allows if `role='admin'` in users table — acceptable | Low |
| Customer accesses admin routes | **No** | All `/admin/*` routes use `requireAdmin` which verifies `role='admin'` in users table | N/A — Well protected ✅ |
| Store admin accesses another tenant's data | **No (single-tenant)** | Current architecture is single-store. Multi-tenancy at platform level uses separate DB projects | N/A |
| User escalates role from customer to admin | **No** | No public endpoint to change own role. `PATCH /admin/users/:id/role` requires `requireAdmin` | N/A — Well protected ✅ |
| Coupons reused beyond `max_uses` | **Yes** | Non-atomic `used_count` increment (SEC-005). Race condition allows concurrent use | High |
| Coupons reused per-user beyond `max_uses_per_user` | **Yes** | Per-user limit NOT enforced at order time (SEC-008) | Medium |
| Checkout submitted multiple times (double charge) | **Partial** | No idempotency key on `POST /orders`. Rapid double-click creates duplicate orders. Stock check may prevent duplicate stock deduction but order records are duplicated | Medium |
| Order status changed without permission | **No** | Status changes require `requireAdmin` | N/A — Well protected ✅ |
| Uploaded files execute code or expose data | **No** | Extension whitelist (jpg/jpeg/png/webp/avif), multer memory storage, no shell execution | N/A — Well protected ✅ |
| External image URLs create SSRF issues | **Partial** | `POST /admin/products/:id/images` accepts external HTTPS URLs (validates `https://` prefix). Server doesn't fetch these URLs itself (stored as-is). Client renders them. Risk is low. | Low |
| Webhook replayed without signature verification | **N/A** | No webhook receivers found in current codebase | N/A |
| Mass assignment allows setting `role: admin` | **No** | User profile update only accepts `full_name` and `default_address`. Order creation doesn't touch users table. Admin role change is separate endpoint with auth. | N/A — Well protected ✅ |
| OTP bypass via test code | **Yes** | `+994551234567` + `999999` always authenticates (SEC-002) | Critical |

---

## 6. Secrets & Configuration Review

| Category | Finding | File/Location | Risk | Recommendation |
|---|---|---|---|---|
| Service-role keys | Live keys in working tree | `.env` (SUPABASE_SERVICE_ROLE_KEY) | Critical | Rotate + use secrets manager |
| Control_Plane keys | Live service key | `.env` (CONTROL_PLANE_SUPABASE_SERVICE_KEY) | Critical | Rotate + use secrets manager |
| Messaging token | UltraMsg API token | `.env` (ULTRAMSG_TOKEN) | High | Rotate + move to secret store |
| Scheduler secret | Plaintext shared secret | `.env` (PLATFORM_SCHEDULER_SECRET) | High | Rotate + use strong random value |
| Session secret | 64-byte base64 secret | `.env` (SESSION_SECRET) | Medium | Rotate if exposed in git history |
| Anon keys in tracked file | Supabase anon keys | `vercel.json` (build.env) | Low | Move to Vercel env vars UI |
| CORS | Wildcard `*` | `app.ts` | High | Restrict to known origins |
| Error detail leakage | Never leaks | `errorHandler.ts` | None ✅ | Keep as-is |
| Source maps | Not configured in vercel.json | Vite default | Low | Explicitly disable in prod build |
| Debug mode | NODE_ENV=production in .env | `.env` | OK ✅ | Verify Railway also sets it |

⚠️ All sensitive values masked in this report.

### Security Headers Checklist

| Header | Present? | Value | Recommendation |
|---|---|---|---|
| Content-Security-Policy | ❌ No | — | Add via helmet or custom middleware |
| X-Frame-Options | ❌ No | — | Set to `DENY` or `SAMEORIGIN` |
| X-Content-Type-Options | ❌ No | — | Set to `nosniff` |
| Strict-Transport-Security | ❌ No | — | Set `max-age=31536000; includeSubDomains` |
| X-XSS-Protection | ❌ No | — | Set to `0` (modern approach: rely on CSP) |
| Referrer-Policy | ❌ No | — | Set to `strict-origin-when-cross-origin` |
| Permissions-Policy | ❌ No | — | Restrict camera, microphone, geolocation |
| Cross-Origin-Opener-Policy | ❌ No | — | Set to `same-origin` |
| Cross-Origin-Resource-Policy | ❌ No | — | Set to `same-origin` |

---

## 7. Recommended Fix Plan

### P0 — Must Fix Before Production (Critical + High)

| Finding ID | Title | Effort | Owner |
|---|---|---|---|
| SEC-001 | Rotate all exposed secrets, remove from .env/vercel.json | 2 hours | DevOps |
| SEC-002 | Remove OTP test bypass (or gate behind NODE_ENV) | 30 min | Backend |
| SEC-003 | Configure CORS with explicit origin whitelist | 30 min | Backend |
| SEC-004 | Add `express-rate-limit` on auth/orders/search endpoints | 2 hours | Backend |
| SEC-005 | Atomic coupon usage increment (conditional UPDATE or RPC) | 2 hours | Backend |
| SEC-006 | Disable or restrict migration endpoint to super-admin | 30 min | Backend |

### P1 — Should Fix Soon (Medium)

| Finding ID | Title | Effort | Owner |
|---|---|---|---|
| SEC-007 | Add auth or rate-limit to coupon validate endpoint | 1 hour | Backend |
| SEC-008 | Enforce per-user coupon usage limit at order time | 1 hour | Backend |
| SEC-009 | Add `helmet` middleware for security headers | 30 min | Backend |
| SEC-010 | Derive session password from HMAC(userId + secret) | 1 hour | Backend |
| SEC-011 | Add `ENABLE_DEV_ROUTES` flag as defense-in-depth | 30 min | Backend |

### P2 — Nice to Improve (Low + Hardening)

| Finding ID | Title | Effort | Owner |
|---|---|---|---|
| SEC-012 | Explicitly set `express.json({ limit: '100kb' })` | 5 min | Backend |
| SEC-013 | Swap multer/requireAdmin middleware order on upload route | 5 min | Backend |
| SEC-014 | Add confirmation step for admin role changes | 2 hours | Full-stack |
| SEC-015 | Update vitest, esbuild to patched versions | 30 min | DevOps |
| SEC-016 | Implement compensating stock rollback on partial failure | 4 hours | Backend |
| SEC-017 | Replace console.log with pino logger | 15 min | Backend |
| SEC-018 | Implement server-side token invalidation on signout | 2 hours | Backend |
| SEC-019 | Add min/max bounds to price and stock in Zod schema | 15 min | Backend |

---

## 8. Security Regression Checklist

```markdown
## Security Release Checklist

### Access Control
- [ ] All admin routes have `requireAdmin` middleware
- [ ] All authenticated routes have `requireUser` middleware
- [ ] No IDOR — all queries scoped to authenticated user/tenant
- [ ] Role escalation not possible via API manipulation
- [ ] Migration endpoint disabled or restricted to super-admin
- [ ] Upload routes check auth BEFORE processing file data

### Input Validation
- [ ] All admin write endpoints use `validate(zodSchema)` middleware
- [ ] File uploads restricted by type (whitelist), size (multer limit), and content
- [ ] No raw SQL interpolation anywhere in codebase
- [ ] URL parameters and query strings validated (Express 5 array handling)
- [ ] Price and stock values have min/max bounds

### Authentication & Sessions
- [ ] OTP test bypass code REMOVED from production
- [ ] OTP rate limiting active (per-phone + global IP-based)
- [ ] Session passwords derived from HMAC, not predictable from user ID
- [ ] Signout invalidates tokens server-side
- [ ] No hardcoded test phones bypass rate limits in production

### Business Logic
- [ ] Prices always sourced from database, never from client
- [ ] Stock decremented atomically via RPC (no TOCTOU)
- [ ] Coupons validated server-side with global AND per-user limits enforced
- [ ] Coupon used_count incremented atomically (conditional UPDATE)
- [ ] Checkout is idempotent (idempotency key prevents duplicate orders)
- [ ] Partial stock deduction failure triggers compensating rollback

### Configuration
- [ ] No secrets in repository (grep for service keys in tracked files)
- [ ] CORS whitelist is explicit (no wildcard with credentials)
- [ ] Security headers present (helmet or custom middleware)
- [ ] NODE_ENV=production enforced in deployment environment
- [ ] Source maps not publicly accessible
- [ ] `express.json()` has explicit size limit

### Rate Limiting
- [ ] Global rate limit on all API routes (100 req/min/IP)
- [ ] Strict rate limit on auth endpoints (5 req/min/IP)
- [ ] Strict rate limit on order creation (10 req/min/IP)
- [ ] Coupon validation rate-limited or requires auth

### Dependencies
- [ ] `pnpm audit` shows no critical/high vulnerabilities in runtime deps
- [ ] Lockfile committed and integrity verified
- [ ] No dev dependencies have critical CVEs affecting CI pipeline

### Monitoring & Logging
- [ ] No `console.log` in production code paths
- [ ] All admin mutations logged via `writeAudit()`
- [ ] Failed auth attempts logged with IP for anomaly detection
- [ ] No PII/tokens/card data in log output
```

---

## Appendix: Files Reviewed

| File | Purpose |
|------|---------|
| `.env` | Environment configuration (secrets) |
| `vercel.json` | Deployment configuration |
| `.gitignore` | Version control exclusions |
| `package.json` | Root workspace config |
| `artifacts/api-server/src/app.ts` | Express app setup |
| `artifacts/api-server/src/routes/index.ts` | Route aggregator |
| `artifacts/api-server/src/routes/auth.ts` | OTP authentication |
| `artifacts/api-server/src/routes/orders.ts` | Order creation + retrieval |
| `artifacts/api-server/src/routes/cart.ts` | Cart merge |
| `artifacts/api-server/src/routes/coupons.ts` | Coupon validation |
| `artifacts/api-server/src/routes/products.ts` | Product queries |
| `artifacts/api-server/src/routes/profile.ts` | User profile |
| `artifacts/api-server/src/routes/comments.ts` | Product reviews |
| `artifacts/api-server/src/routes/pages.ts` | CMS pages |
| `artifacts/api-server/src/routes/search.ts` | Search suggestions |
| `artifacts/api-server/src/routes/wishlist.ts` | Wishlists |
| `artifacts/api-server/src/routes/migration.ts` | DB migrations |
| `artifacts/api-server/src/routes/store-metrics.ts` | Store metrics |
| `artifacts/api-server/src/routes/product-images.ts` | Image management |
| `artifacts/api-server/src/routes/dev.ts` | Dev/test routes |
| `artifacts/api-server/src/routes/admin/index.ts` | Admin aggregator |
| `artifacts/api-server/src/routes/admin/products.ts` | Admin product CRUD |
| `artifacts/api-server/src/routes/admin/orders.ts` | Admin order management |
| `artifacts/api-server/src/routes/admin/users.ts` | Admin user management |
| `artifacts/api-server/src/routes/admin/coupons.ts` | Admin coupon CRUD |
| `artifacts/api-server/src/routes/admin/banners.ts` | Admin banner CRUD |
| `artifacts/api-server/src/routes/admin/settings.ts` | Store settings |
| `artifacts/api-server/src/routes/admin/schemas.ts` | Zod validation schemas |
| `artifacts/api-server/src/routes/platform/index.ts` | Platform aggregator |
| `artifacts/api-server/src/routes/platform/auth.ts` | Super-admin auth/MFA |
| `artifacts/api-server/src/routes/platform/impersonation.ts` | Support access |
| `artifacts/api-server/src/middlewares/requireAdmin.ts` | Admin auth middleware |
| `artifacts/api-server/src/middlewares/requireUser.ts` | User auth middleware |
| `artifacts/api-server/src/middlewares/requireSuperAdmin.ts` | Super-admin middleware |
| `artifacts/api-server/src/middlewares/requireServiceCredential.ts` | Service auth |
| `artifacts/api-server/src/middlewares/errorHandler.ts` | Central error handler |
| `artifacts/api-server/src/middlewares/validate.ts` | Zod validation middleware |
| `artifacts/api-server/src/middlewares/platformStatus.ts` | Platform gate |
| `artifacts/api-server/src/lib/supabase.ts` | Supabase client factory |
| `artifacts/api-server/src/lib/otp.ts` | OTP generation/verification |

---

*End of Security Audit Report*
