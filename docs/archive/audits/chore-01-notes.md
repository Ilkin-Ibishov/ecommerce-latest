# Chore Batch 01 — Implementation Notes

**Date:** 2026-11-02  
**Branch:** `chore/batch-01`

---

## 1. Changes per Task

### Task 1 — `SESSION_SECRET` Hardcoded Fallback & Startup Assertion
- **Fallback Removed:** Removed `"fallback-dev-secret"` fallback string from `artifacts/api-server/src/routes/auth.ts`.
- **Validation Helper Extracted:** Created `artifacts/api-server/src/lib/session-secret.ts` exporting:
  - `assertSessionSecret(secret?)`: Asserts presence and enforces a minimum length of 32 characters.
  - `deriveSessionPassword(userId, secret?)`: Derives deterministic session HMAC password, failing closed if missing or weak.
- **Startup Probe:** Integrated `assertSessionSecret()` in `artifacts/api-server/src/index.ts` prior to `app.listen()`, preventing server boot with missing/weak configuration.
- **Env Validation Test Extension:** Added `SESSION_SECRET` to `REQUIRED_VARS` in `artifacts/api-server/tests/setup.ts` and `artifacts/api-server/tests/env-validation.test.ts`. Extended property tests and unit tests covering absent, weak, and valid secret derivation.
- **Derivation Scheme Note:** Deriving session passwords via `HMAC(SESSION_SECRET, userId)` avoids GoTrue's missing session creation endpoint, but couples all customer authentication credentials to a single cluster secret. Rotating `SESSION_SECRET` will invalidate or alter derived passwords. When GoTrue / Supabase Auth exposes native session issuance (`admin.auth.createSession`), this derivation should be replaced.

### Task 2 — Delete `.migration-backup/`
- **Dependency Search:** Confirmed zero live references across application source code, config files, build scripts, or CI workflows (`.migration-backup` appeared only in an invariant skip list and historical documentation notes).
- **Removal:** Removed all 527 tracked files (103 MB) via `git rm -r`.
- **Ignore Rule:** Added `/.migration-backup/` to `.gitignore`.

### Task 3 — Mark Stale Documents
- Verified findings and actual implementation state against code, migrations, and test suites.
- Added dated status headers at the top of:
  - `SECURITY_AUDIT.md`: Clarified status of SEC-001 through SEC-013.
  - `security-report.md`: Verified all 8 Supabase RLS findings (SEC-001 through SEC-008) are remediated.
  - `docs/tasks/backlog.md`: Verified status of H1–H7, M1–M8, L1–L4, and S1.

---

## 2. Contradictions Found with the Prompt

1. **Remediation Scope in `SECURITY_AUDIT.md`:**
   The prompt stated that "SEC-001, SEC-002, SEC-003, SEC-004 and the RLS findings are already remediated". Verification showed:
   - In `SECURITY_AUDIT.md`: SEC-001 through SEC-007 are remediated, but SEC-008 (comment content length/HTML sanitization) and SEC-009 (non-production permissive CORS) remain open. SEC-010 was remediated as part of Task 1.
   - In `security-report.md`: All RLS findings (SEC-001 through SEC-008) are fully remediated.
2. **`AGENTS.md` vs. Task 3 on `docs/tasks/`:**
   `AGENTS.md` contains the rule: *"Never edit anything under `docs/tasks/` — specs are written by the architect, not the implementer."* However, Task 3 explicitly commanded: *"mark three documents as stale ... `docs/tasks/backlog.md`"*. We resolved this tension by adding only the requested dated status header to `backlog.md` (leaving the underlying backlog prose untouched) to prevent other agents from acting on stale architectural descriptions.
3. **Local Test Environment Assumptions (`pnpm test`):**
   Root `pnpm test` executes all vitest workspace projects (`store-unit`, `api-integration`, `env-validation`). The `api-integration` suite requires Supabase database credentials asserted by `tests/setup.ts`, which are supplied via GitHub Secrets in CI (`.github/workflows/test.yml`), but are not present in an unconfigured local checkout without `.env`.

---

## 3. Decisions & What Was Not Done

1. **Auth Flow Redesign:** Chose not to alter the OTP auth flow architecture beyond removing the fallback and validating secret strength, adhering to prompt instructions.
2. **Document Content Preservation:** Did not rewrite the historical finding descriptions or text bodies in `SECURITY_AUDIT.md`, `security-report.md`, or `docs/tasks/backlog.md`. Only the status headers were added.
3. **Environment Files:** Did not create, edit, or commit `.env` or `.env.test` files or secret keys, honoring AGENTS.md rules.
