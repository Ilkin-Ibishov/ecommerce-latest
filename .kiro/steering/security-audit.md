---
inclusion: fileMatch
fileMatchPattern: ['**/SECURITY_AUDIT.md']
---

# Security Audit Playbook

Security-review playbook for this white-label e-commerce platform. Auto-loads when editing `SECURITY_AUDIT.md`; also invoke manually with `#security-audit`. Follow it top-to-bottom: respect the boundaries, run the first-pass commands, map findings to OWASP + severity, then write the report before touching code.

## Hard Boundaries (non-negotiable)

- Audit THIS codebase only. Do NOT probe Supabase infra, Vercel, payment processors, or any third-party service.
- Static analysis first. Run dynamic checks only against local/dev — never production.
- Never print secret values. Report `file path + variable name` and mask the value.
- Produce `SECURITY_AUDIT.md` before changing any code. Fixes come after the report is reviewed.
- Read-only by default; propose fixes as recommendations, not silent edits.

## Scope

- **Storefront** (React SPA): cart, checkout, auth, wishlist, product browse
- **Admin panel**: product CRUD, orders, inventory, coupons, settings
- **API server** (Express 5, `artifacts/api-server`): REST endpoints, Supabase RLS, admin middleware
- **Multi-tenant** (white-label): store isolation, tenant-scoped data and storage

## Severity Levels

| Level | Criteria |
|-------|----------|
| Critical | Remote code exec, full data breach, payment theft, admin takeover |
| High | Privilege escalation, IDOR exposing PII, payment manipulation, tenant data leak |
| Medium | Stored XSS, CSRF on state-changing ops, internal info disclosure |
| Low | Missing headers, verbose dev errors, minor info leakage |

## OWASP Top 10 (2021) mapping

Tag every finding with one: A01 Broken Access Control · A02 Crypto Failures · A03 Injection · A04 Insecure Design · A05 Misconfiguration · A06 Vulnerable Components · A07 Auth Failures · A08 Data Integrity · A09 Logging Failures · A10 SSRF.

## Highest-Priority Attack Scenarios

Check these first — they map to the platform's real money and data risks.

### Price & payment integrity
- Checkout must re-read prices from the DB; never trust client-supplied prices/totals.
- Discounts go through `calculateDiscount()` (`src/lib/coupon-calc.ts`) — no inline math.
- Coupons validated server-side with usage limits enforced.
- Checkout is idempotent (double-submit / replay prevention).

### Access control
- Every admin route is guarded by `requireAdmin` middleware (`src/routes/admin/`); customer routes by `requireUser`.
- `req.admin` / `req.user` / `req.authUser` are set by middleware only, never read from client input.
- IDOR: a customer cannot read/modify another customer's orders, cart, or profile.
- No mass-assignment role escalation on user/profile update endpoints.

### Stock & inventory
- Stock changes only via `decrementStockSafe` / `incrementStock` (`src/lib/rpc.ts`) → DB RPCs, never raw `UPDATE`.
- Reject negative or zero-abuse quantities; cart caps at 99 (`mergeGuestCart`, `src/lib/cart-merge.ts`).
- Watch TOCTOU races on concurrent checkout of low-stock items.

### Multi-tenant isolation (white-label)
- All DB queries scoped by store/tenant ID; Supabase RLS policies are tenant-aware.
- Store admin A cannot see store B's products, orders, or customers.
- Storage buckets scoped per tenant.

### Auth & sessions
- Supabase JWT: expiry, refresh, and invalidation on logout behave correctly.
- Expired/revoked tokens cannot reach admin routes.
- Password-reset tokens are single-use and time-limited.
- OAuth redirect targets validated against a whitelist.

### File upload
- Images only, size-limited, path-traversal safe, no stored XSS via SVG.

### Configuration
- Service-role key never in the client bundle (no `VITE_` prefix) — verify via `resolveSupabaseEnv` (`src/lib/env.ts`).
- CORS uses an explicit whitelist (no wildcard with credentials).
- `errorHandler` (`src/middlewares/errorHandler.ts`) returns generic 500; never leaks `err.message`/`err.stack`.
- `pnpm audit` reports no critical/high vulnerabilities.

## Automated First-Pass Commands

Run from repo root. Treat results as leads to confirm, not conclusions.

```bash
# Dependency vulnerabilities
pnpm audit

# Hardcoded secrets
grep -rn "sk_live\|sk_test\|password\s*=\|secret\s*=" --include="*.ts" --exclude-dir=node_modules

# Admin/API routes — confirm each has auth middleware
grep -rn "router\.\(get\|post\|put\|delete\|patch\)" --include="*.ts" artifacts/api-server/src/routes/

# Raw SQL / unsafe query construction
grep -rn "\.query(\`\|\.execute(\`\|sql\`" --include="*.ts" --exclude-dir=node_modules

# Dangerous execution sinks
grep -rn "eval(\|new Function(\|child_process\|exec(" --include="*.ts" --exclude-dir=node_modules
```

## Project-Specific Controls to Verify

Confirm each control exists AND is actually used at every relevant call site (grep for bypasses).

| Control | File (`artifacts/api-server/`) | What to verify |
|---------|-------------------------------|----------------|
| Admin middleware | `src/middlewares/requireAdmin.ts` | Verifies JWT + admin role, sets `req.admin`; attached to all admin routes |
| Input validation | `src/middlewares/validate.ts` | Zod `validate(schema)` on every admin write |
| Stock RPC | `src/lib/rpc.ts` | `decrementStockSafe`/`incrementStock` use DB functions, not raw UPDATE |
| Coupon math | `src/lib/coupon-calc.ts` | `calculateDiscount()` — server-authoritative, no client trust |
| Cart merge | `src/lib/cart-merge.ts` | `mergeGuestCart()` caps quantity at 99 |
| Error handler | `src/middlewares/errorHandler.ts` | Generic 500, no `err.message`/`err.stack` leak |
| Audit log | `src/lib/audit.ts` | `writeAudit()` fire-and-forget; sensitive actions logged |
| Env resolution | `src/lib/env.ts` | `resolveSupabaseEnv()` — service key never client-exposed |

## Report Structure (`SECURITY_AUDIT.md`)

1. Executive summary — posture rating + top 5 risks
2. Application map — routes, roles, trust boundaries
3. Threat model table — asset, threat, scenario, impact, existing protection, gap
4. Detailed findings — `SEC-001`, `SEC-002`… each with severity, OWASP tag, evidence (file:line), fix, regression test
5. Ecommerce abuse-case matrix — price tamper, IDOR, role escalation, stock manipulation, tenant leak
6. Secrets & headers review
7. Prioritized fix plan — P0/P1/P2
8. Security regression checklist — pre-release gates
