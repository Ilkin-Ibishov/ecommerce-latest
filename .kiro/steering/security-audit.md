---
inclusion: manual
---

# Security Audit Playbook

Adapted from the red-team-security skill. Use `#security-audit` when performing security reviews of this e-commerce platform.

## Scope

This is a white-label e-commerce platform with:
- **Public storefront** (React SPA) — cart, checkout, auth, wishlist, product browse
- **Admin panel** — product CRUD, order management, inventory, coupons, settings
- **API server** (Express 5) — REST endpoints, Supabase RLS, admin middleware
- **Multi-tenant potential** (white-label) — store isolation, tenant-scoped data

## Hard Boundaries

- Authorized review of this codebase ONLY — do NOT probe Supabase infra, Vercel, or third-party services
- Read-only static analysis first; dynamic validation only against local/dev
- Never expose real secrets in output — report file path + variable name only, mask values
- Produce `SECURITY_AUDIT.md` report before making any code changes

## OWASP Alignment

Map findings to OWASP Top 10 (2021): A01 Broken Access Control, A02 Crypto Failures, A03 Injection, A04 Insecure Design, A05 Misconfiguration, A06 Vulnerable Components, A07 Auth Failures, A08 Data Integrity, A09 Logging Failures, A10 SSRF.

## Severity Levels

| Level | Criteria |
|-------|----------|
| Critical | Remote code exec, full data breach, payment theft, admin takeover |
| High | Privilege escalation, IDOR exposing PII, payment manipulation, tenant data leak |
| Medium | Stored XSS, CSRF on state-changing ops, internal info disclosure |
| Low | Missing headers, verbose dev errors, minor info leakage |

## Ecommerce-Specific Attack Scenarios

These are the highest-priority checks for this platform:

### Price & Payment Integrity
- Does checkout trust client-supplied prices? (Must always re-read from DB)
- Can discount amounts be manipulated? (Check `calculateDiscount()` in `lib/coupon-calc.ts`)
- Is checkout idempotent? (Double-submit prevention)
- Are coupons validated server-side with usage limits enforced?

### Access Control
- Are all admin routes protected by `requireAdmin` middleware? (Check `src/routes/admin/`)
- Can a customer access another customer's orders? (IDOR check on order endpoints)
- Can a user escalate role via API? (Mass assignment on user update)
- Is `req.admin` / `req.user` always set by middleware, never trusted from client?

### Stock & Inventory
- Are stock decrements atomic? (Must use `decrementStockSafe` RPC in `lib/rpc.ts`)
- Can negative quantities be submitted?
- TOCTOU race conditions on concurrent checkout?

### Multi-Tenant Isolation (when white-label is active)
- Are all DB queries scoped by store/tenant ID?
- Can store admin A see store B's products/orders?
- Are Supabase RLS policies tenant-aware?
- Are storage buckets scoped per tenant?

### Auth & Sessions
- Supabase JWT: expiration, refresh logic, invalidation on logout
- Admin session: can expired tokens still access admin routes?
- Password reset: single-use tokens, time-limited?
- OAuth redirect: validated against whitelist?

### File Upload
- Type restriction (images only)?
- Size limits enforced?
- Path traversal prevention?
- Stored XSS via SVG?

### Configuration
- Service-role key NOT exposed to client bundle (no `VITE_` prefix)
- CORS explicit whitelist (no wildcard + credentials)
- Error handler returns generic 500, never leaks `err.message`/`err.stack`
- `pnpm audit` shows no critical/high vulnerabilities

## Automated First-Pass Commands

```bash
# Dependency vulnerabilities
pnpm audit

# Potential secrets in code
grep -rn "sk_live\|sk_test\|password\s*=\|secret\s*=" --include="*.ts" --exclude-dir=node_modules

# Routes without auth middleware
grep -rn "router\.\(get\|post\|put\|delete\|patch\)" --include="*.ts" artifacts/api-server/src/routes/

# Unsafe query patterns
grep -rn "\.query\(\`\|\.execute\(\`\|sql\`" --include="*.ts" --exclude-dir=node_modules

# Eval/exec usage
grep -rn "eval(\|new Function(\|child_process\|exec(" --include="*.ts" --exclude-dir=node_modules
```

## Report Structure

Output to `SECURITY_AUDIT.md`:
1. Executive summary (posture rating + top 5 risks)
2. Application map (routes, roles, trust boundaries)
3. Threat model table (asset, threat, scenario, impact, existing protection, gap)
4. Detailed findings (SEC-001, SEC-002... with severity, evidence, fix, regression test)
5. Ecommerce abuse case matrix (price tamper, IDOR, role escalation, stock manipulation)
6. Secrets & headers review
7. Prioritized fix plan (P0/P1/P2)
8. Security regression checklist (pre-release gates)

## Project-Specific Patterns to Verify

| Pattern | File | What to check |
|---------|------|---------------|
| Admin middleware | `src/middlewares/requireAdmin.ts` | Verifies JWT + admin role, sets `req.admin` |
| Stock RPC | `lib/rpc.ts` | `decrementStockSafe` uses DB function, not raw UPDATE |
| Coupon math | `lib/coupon-calc.ts` | `calculateDiscount()` — no client-trusting |
| Cart merge | `lib/cart-merge.ts` | `mergeGuestCart()` — caps at 99 |
| Error handler | `src/middlewares/errorHandler.ts` | Generic 500, no `err.message` leak |
| Audit log | `lib/audit.ts` | `writeAudit()` — fire-and-forget |
| Env resolution | `lib/env.ts` | `resolveSupabaseEnv()` — no service key in client |
| Validate middleware | `src/middlewares/validate.ts` | Zod schema validation on admin writes |
