# Security Audit Report

**Project:** White-Label E-Commerce Platform  
**Date:** 2025-01-XX (Static Analysis)  
**Scope:** Source code review of `artifacts/api-server/` and `artifacts/store/`  
**Methodology:** OWASP Top 10 (2021), Ecommerce-specific threat modeling  

---

## 1. Executive Summary

**Overall Posture: MODERATE** — The platform demonstrates strong security fundamentals (centralized auth middleware, atomic stock RPCs, generic error responses, rate limiting, helmet headers) but has several findings that require attention before production hardening.

### Top 5 Risks

| # | Risk | Severity | OWASP |
|---|------|----------|-------|
| 1 | Missing quantity validation allows negative/zero quantities in order creation | High | A04 Insecure Design |
| 2 | Platform secret exposed to client via `VITE_` prefix (`VITE_STORE_PLATFORM_SECRET`) | High | A02 Crypto Failures |
| 3 | Bootstrap endpoint accessible without secret when `BOOTSTRAP_SECRET` env is unset | High | A01 Broken Access Control |
| 4 | Vulnerable dependencies (multer DoS, vitest RCE, vite path traversal) | High | A06 Vulnerable Components |
| 5 | TOCTOU race in order checkout between stock check and decrement | Medium | A04 Insecure Design |

---

## 2. Findings Table

| ID | Severity | Description | File | OWASP | Fix |
|----|----------|-------------|------|-------|-----|
| SEC-001 | **High** | No validation on `item.quantity` in order creation — negative, zero, float, or extremely large values accepted | `routes/orders.ts:40-52` | A04 | Add Zod validation: `quantity` must be positive integer ≤ 99 |
| SEC-002 | **High** | `VITE_STORE_PLATFORM_SECRET` env var used in `NotificationCenterPage.tsx` — Vite bundles all `VITE_*` vars into client JS | `store/src/pages/admin/NotificationCenterPage.tsx:30` | A02 | Route notification fetches through the API server; remove `VITE_` prefix from secret |
| SEC-003 | **High** | Bootstrap endpoint has no auth when `BOOTSTRAP_SECRET` is not set — allows unauthenticated admin creation in non-prod or misconfigured prod | `routes/bootstrap.ts:14-18` | A01 | Always require a secret (fail closed); or disable bootstrap in production entirely |
| SEC-004 | **High** | 19 dependency vulnerabilities including 1 critical (vitest RCE), 6 high (multer DoS, vite path traversal, undici TLS bypass) | `pnpm-lock.yaml` | A06 | Run `pnpm update` for multer≥2.2.0, vite≥7.3.5, vitest≥3.2.6, undici≥7.28.0 |
| SEC-005 | **Medium** | TOCTOU race condition in checkout: stock is checked, then order created, then stock decremented — concurrent requests can oversell | `routes/orders.ts:110-135` | A04 | Move stock decrement before order insert, or wrap in a transaction; the RPC fallback with `gte("stock", qty)` partially mitigates but order is already created |
| SEC-006 | **Medium** | Coupon per-user usage check happens AFTER incrementing `used_count` — race condition allows exceeding `max_uses_per_user` | `routes/orders.ts:140-160` | A04 | Check per-user usage BEFORE incrementing global count; use a single atomic operation |
| SEC-007 | **Medium** | `admin/upload` route in `products.ts` validates only file extension, not magic bytes — extension-spoofed files can bypass | `routes/admin/products.ts:23-30` | A04 | Use the `validateAndUpload` from `asset-uploader.ts` (which checks magic bytes) or add `detectMimeType()` check |
| SEC-008 | **Low** | Comment content not sanitized/length-limited — potential for stored XSS if rendered as HTML, and DoS via very large content | `routes/comments.ts:24-40` | A03 | Add max length validation (e.g., 2000 chars); ensure frontend renders as text only |
| SEC-009 | **Low** | CORS fallback in non-production mode is `true` (allows any origin) — if `NODE_ENV` is accidentally unset, all origins are allowed | `app.ts:20-30` | A05 | Default to restrictive CORS; only open for explicit dev mode |
| SEC-010 | **Low** | `SESSION_SECRET` fallback in auth.ts is a hardcoded string `"fallback-dev-secret"` — if env not set, all sessions share a predictable key | `routes/auth.ts:80` | A02 | Fail with error if `SESSION_SECRET` is not configured in production |
| SEC-011 | **Informational** | Dev routes (`/dev/mock-otp`, `/dev/last-otp`) gated by `NODE_ENV !== "production"` — correct but relies on env being properly set | `routes/dev.ts` | A05 | Document that `NODE_ENV=production` is mandatory; add startup assertion |
| SEC-012 | **Informational** | Migration endpoint disabled in production (`NODE_ENV` check) — appropriate defense-in-depth | `routes/migration.ts:90` | — | No action needed |
| SEC-013 | **Informational** | `getAdminSupabase()` uses service-role key without request scoping — expected for server-side but worth noting | `lib/supabase.ts` | — | Consider per-request RLS where appropriate |

---

## 3. Ecommerce Abuse Case Matrix

| Attack Scenario | Possible? | Evidence | Existing Protection | Gap |
|-----------------|-----------|----------|--------------------|----|
| **Price manipulation** (client sends fake price) | ❌ No | `orders.ts:34-50` re-reads prices from DB | Server always queries `products.price` | None |
| **IDOR: User A sees User B's orders** | ❌ No | `orders.ts:173-178` checks `user_id` match | `requireUser` + ownership check + admin fallback | None |
| **Role escalation via API** | ❌ No | Profile only allows `full_name`/`default_address`; role change requires `requireAdmin` | Explicit field allowlist in PATCH /profile | None |
| **Negative quantity in order** | ✅ **Yes** | `orders.ts` — `quantity` field is typed as `number` but never validated for `> 0` or `isInteger` | Stock check `stock < item.quantity` would pass for negative qty | **SEC-001** |
| **Coupon reuse (global)** | ❌ No | `orders.ts:70-75` checks `used_count < max_uses` | Conditional update guard | Minor race (SEC-006) |
| **Coupon reuse (per-user)** | ⚠️ Partial | Per-user check runs AFTER global increment | `coupon_usages` table + count check | Race window (SEC-006) |
| **Coupon stacking** | ❌ No | Only one `coupon_code` accepted per order | Single coupon field in request | None |
| **Negative discount** | ❌ No | `calculateDiscount()` caps at subtotal, rounds to 2 decimal | `Math.min(discount, subtotal)` | None |
| **Stock manipulation (race)** | ⚠️ Partial | `decrementStockSafe` RPC is atomic; fallback uses `gte("stock", qty)` | RPC + conditional update | Order may exist briefly before rollback (SEC-005) |
| **File upload exploit (type bypass)** | ⚠️ Partial | `product-images.ts` uses `validateAndUpload` (magic bytes); `admin/products.ts` upload only checks extension | Two upload paths with different validation | **SEC-007** |
| **File upload path traversal** | ❌ No | Filenames generated server-side (`Date.now()-random.ext`), not from user input | `generateFilename()` in asset-uploader | None |
| **SVG XSS via upload** | ❌ No | Only image/jpeg, image/png, image/webp, image/avif accepted via magic bytes | `MIME_SIGNATURES` allowlist excludes SVG | None |
| **Admin route without middleware** | ❌ No | Every route in `routes/admin/*.ts` uses `requireAdmin` | Grep confirms 100% coverage | None |
| **Bootstrap admin takeover** | ⚠️ Conditional | If `BOOTSTRAP_SECRET` env is unset, endpoint has no auth | Self-disabling after first admin; secret required when env set | **SEC-003** |

---

## 4. Configuration Review

### CORS ✅ Good (with caveat)
- Production uses explicit origin whitelist from `ALLOWED_ORIGINS` env
- Credentials mode enabled (cookies)
- **Caveat:** Non-production allows all origins (`cors(true)`) — if NODE_ENV is unset, this is the default (SEC-009)

### Security Headers ✅ Good
- `helmet()` applied before all routes
- Adds X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.

### Rate Limiting ✅ Good
- Global: 100 req/min per IP
- Auth: 10 req/min per IP
- Orders: 10 req/min per IP
- Coupon validation: 5 req/min per IP
- OTP: Custom DB-based rate limiting + express-rate-limit

### Error Handling ✅ Good
- Central `errorHandler` returns generic `{ error: "Internal server error" }` only
- Never leaks `err.message` or `err.stack` to client
- Logs full error details via `req.log.error`

### Body Size Limit ✅ Good
- `express.json({ limit: "100kb" })` prevents large payload DoS

### Environment Variables
- `SUPABASE_SERVICE_ROLE_KEY` — NOT prefixed with `VITE_` ✅
- `VITE_SUPABASE_URL` — public URL, safe to expose ✅
- `VITE_SUPABASE_ANON_KEY` — public anon key, safe to expose ✅
- `VITE_STORE_PLATFORM_SECRET` — ❌ **Secret exposed to client bundle** (SEC-002)
- `.env` is in `.gitignore` — not committed to repo ✅
- `resolveSupabaseEnv()` on client side references `SUPABASE_SERVICE_ROLE_KEY` but Vite won't expose non-`VITE_` vars ✅

### Trust Proxy ✅
- `app.set("trust proxy", 1)` — correct for single reverse proxy (Vercel)

---

## 5. Prioritized Fix Plan

### P0 — Fix Immediately (before next production deploy)

| ID | Action | Effort |
|----|--------|--------|
| SEC-001 | Add quantity validation in `/orders` POST: reject if `quantity` is not a positive integer ≤ 99 | 30 min |
| SEC-002 | Remove `VITE_STORE_PLATFORM_SECRET` from client code; route notification fetches through API server proxy | 2 hrs |
| SEC-003 | Make bootstrap always require a secret (or disable the route when `NODE_ENV=production`) | 30 min |

### P1 — Fix This Sprint

| ID | Action | Effort |
|----|--------|--------|
| SEC-004 | Update vulnerable dependencies: `multer≥2.2.0`, `vite≥7.3.5`, `vitest≥3.2.6`, `undici≥7.28.0` | 1 hr |
| SEC-005 | Restructure order creation to decrement stock BEFORE inserting the order, or wrap in a DB transaction | 3 hrs |
| SEC-006 | Move per-user coupon usage check before global `used_count` increment; ideally atomic | 2 hrs |
| SEC-007 | Replace extension-only check in `admin/products.ts` upload with `detectMimeType()` magic byte validation | 1 hr |

### P2 — Address in Next Cycle

| ID | Action | Effort |
|----|--------|--------|
| SEC-008 | Add max-length validation on comment content (e.g., 2000 chars) | 30 min |
| SEC-009 | Default CORS to restrictive mode; require explicit `ALLOW_ALL_ORIGINS=true` for dev | 30 min |
| SEC-010 | Throw startup error if `SESSION_SECRET` is not set in production | 15 min |
| SEC-011 | Add startup assertion: `if (NODE_ENV !== 'production') logger.warn(...)` | 15 min |

---

## 6. Positive Security Patterns Observed

The codebase demonstrates several mature security practices:

1. **Centralized auth middleware** — `requireAdmin`/`requireUser`/`requireSuperAdmin`/`requireServiceCredential` are consistently applied; no inline auth checks in route handlers
2. **Atomic stock operations** — `decrementStockSafe` RPC prevents most race conditions at the DB level
3. **Server-side price resolution** — Checkout ALWAYS re-reads prices from DB, never trusts client
4. **Generic error responses** — Error handler returns opaque 500; structured logging captures details server-side
5. **Constant-time secret comparison** — `timingSafeEqual` used in credential verification (prevents timing attacks)
6. **File upload security** — Magic byte validation in asset-uploader, server-generated filenames, image-only allowlist
7. **Rate limiting** — Multi-tier rate limits on auth, orders, and coupon validation
8. **Audit logging** — All admin mutations tracked via `writeAudit()`
9. **Input validation** — Zod schemas enforced on admin write operations via `validate()` middleware
10. **Cart validation** — Client-side cart context rejects tampered localStorage (negative prices, qty > 99)

---

## 7. Dependency Vulnerability Summary

From `pnpm audit` — 19 total vulnerabilities:

| Severity | Count | Key Packages |
|----------|-------|-------------|
| Critical | 1 | vitest (<3.2.6) — RCE via UI server |
| High | 6 | multer (<2.2.0) DoS, vite (<6.4.3/7.3.5) path traversal, undici (<7.28.0) TLS bypass + DoS |
| Moderate | 8 | qs DoS, vite NTLMv2 disclosure, js-yaml DoS, markdown-it DoS, multer cleanup DoS, undici cache/header injection |
| Low | 4 | esbuild file read, @babel/core file read, undici response poisoning, undici SameSite downgrade |

**Note:** vitest critical and vite high vulnerabilities affect dev tooling only (not production runtime), but should still be patched. The multer high vulnerability (`artifacts/api-server > multer`) affects the production API server directly.

---

## 8. Security Regression Checklist

Pre-release gates to prevent regression:

- [ ] `pnpm audit` reports 0 critical/high vulnerabilities
- [ ] All admin routes have `requireAdmin` middleware (grep check)
- [ ] `NODE_ENV=production` is set in deployment environment
- [ ] `BOOTSTRAP_SECRET` is set in production environment
- [ ] No `VITE_` prefixed variables contain secrets (grep `VITE_.*SECRET|VITE_.*KEY.*SERVICE`)
- [ ] Order creation validates quantity > 0, integer, ≤ 99
- [ ] File uploads validate magic bytes (not just extension)
- [ ] Error responses return only generic messages (no stack traces)
- [ ] Rate limiting is active on auth, order, and coupon endpoints
- [ ] CORS `ALLOWED_ORIGINS` is configured for production domain(s)
