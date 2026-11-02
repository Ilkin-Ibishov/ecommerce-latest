# Chore Batch 02 — Implementation Notes

**Date:** 2026-11-02  
**Branch:** `chore/batch-01`

---

## 1. Changes per Task

### Task 1 — Fix Failing `store-unit` Tests
- **Diagnosis:** Diagnosed the `TypeError: React.act is not a function` error occurring across 5 tests (`src/__tests__/login-modal-profile-reroute.test.ts` and `src/__tests__/coupons-page-admin-fetch.test.ts`).
  - `@testing-library/react@16.3.2` is designed for React 19 and checks:
    `const reactAct = typeof React.act === 'function' ? React.act : DeprecatedReactTestUtils.act;`
  - In React 19, `React.act` is only exported from `cjs/react.development.js`; it is intentionally stripped from `cjs/react.production.js`.
  - When running in an environment with ambient `NODE_ENV=production` (such as Windows user/process environments or container hosts), `require("react")` resolves to `cjs/react.production.js`.
  - Because `React.act` is `undefined` in the production React bundle, `typeof React.act === 'function'` evaluated to `false`, causing `@testing-library/react` to fall back to `react-dom/test-utils`' deprecated shim. That shim in turn calls `React.act(callback)`, which threw `TypeError: React.act is not a function`.
- **Resolution:** Added `test.env: { NODE_ENV: "test" }` to `artifacts/store/vitest.config.ts`. This ensures Vitest worker threads always execute store unit tests in test mode, resolving React to `cjs/react.development.js` where `React.act` is defined.
- **Invariants Upheld:** No tests were skipped, no assertions loosened, and no components stubbed out.

### Task 2 — Fresh Clone Runnable Test Tiers
- **Root Scripts Added:** Updated root `package.json`:
  - `"test:unit": "vitest --run --project store-unit --project env-validation"`: Runs purely offline tests that require no database, API server, or credentials (516 tests across 31 files).
  - `"test:integration": "vitest --run --project api-integration"`: Runs the database-backed tier requiring a running API server on port 5000 and Supabase credentials in `.env` / `.env.test`.
  - `"test": "vitest --run"`: Preserved unchanged so CI and fully-configured developer machines continue running all workspace projects.
- **`setup.ts` Dual Env Loading:** Updated `artifacts/api-server/tests/setup.ts` to call `dotenv.config` for `.env.test` first, followed by `.env`. Because `dotenv` does not overwrite existing process environment variables, values in `.env.test` take precedence over `.env`, while `.env` serves as a fallback, and pre-existing environment variables (such as CI secrets) remain untouched.
- **`.env.test.example` Template:** Created `.env.test.example` documenting all required variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`) and optional variables (`API_URL`) with empty values and descriptive one-line comments. No secrets or credentials were included.
- **`.gitignore` Exception:** Added `!.env.test.example` to `.gitignore` under `!.env.example` so git tracks the template despite the `.env.*` wildcard ignore rule.
- **Testing Rules Documentation:** Added a new "Test tiers and commands" section to `.agents/rules/testing.md` detailing the commands, their included projects, and environment requirements, and updated the pre-completion checklist to reference `pnpm run test:unit`.

---

## 2. Contradictions Found with the Prompt

1. **`React.act` Root Cause (Environment vs. Dependencies):**
   - The prompt hypothesized: *"This is a React 19 / testing-library compatibility problem: react-dom/test-utils' act was removed in React 19 and act now lives on react itself. Find out which layer is reaching for the old one — the installed @testing-library/react version, a direct import in the test, or a transitive react-dom/test-utils usage."*
   - Verification revealed: `@testing-library/react` (v16.3.2) was already React 19-aware and checking for `React.act`. There were zero direct imports of `react-dom/test-utils` across the codebase. The layer reaching for `react-dom/test-utils` was `@testing-library/react`'s fallback, which triggered because ambient `NODE_ENV=production` prevented React from exporting `act`. No dependency upgrade was necessary; configuring `test.env.NODE_ENV = "test"` resolved the issue cleanly.
2. **`env-validation` Project Tier Qualification:**
   - The prompt suggested checking whether any api-server project qualifies for `test:unit`.
   - In `.github/workflows/test.yml`, `env-validation` had historically been bundled into the CI `integration-e2e` job. Inspection of `vitest.config.env-test.ts` and `tests/env-validation.test.ts` confirmed that `env-validation` explicitly avoids `setup.ts`, has no database or network dependencies, and tests pure configuration validation logic in isolation. It fully qualifies for `test:unit` and was added to the script.
3. **Flaky Slug Assumption in `storefront-ux.property.test.ts`:**
   - In `artifacts/store/src/__tests__/storefront-ux.property.test.ts`, the property test `consecutive segments follow parent-child relationship` builds a verification map keyed by category slug: `slugToNode.set(n.slug, n)`.
   - When the `categoryTreeArb` generator generates identical slugs for nodes in different tree branches, `slugToNode` overwrites the earlier node. Subsequent parent-child lookups then find the node from the sibling branch, causing an assertion failure on `childNode.parent_id === parentNode.id`.
   - Per `AGENTS.md` and prompt instructions, this test assertion was not modified or loosened.
4. **`.gitignore` Wildcard Masking `.env.test.example`:**
   - The prompt instructed committing `.env.test.example`. However, `.gitignore` contained `.env.*`, which matched and ignored `.env.test.example` by default. An unignore rule (`!.env.test.example`) was required in `.gitignore` to allow tracking.

---

## 3. Decisions & What Was Not Done

1. **No Faking or Stubbing Integration Tests:** Did not mock Supabase credentials or database responses in `api-integration`. The integration suite continues to fail loudly when credentials are absent, preserving the integrity of RLS and invariant tests.
2. **Preserved `.github/workflows/test.yml`:** In accordance with the prompt's scope discipline rule, CI workflows were not redesigned or modified.
3. **No Unnecessary Dependency Upgrades:** Did not bump `@testing-library/react` or other workspace dependencies, as 16.3.2 is fully compatible with React 19 in test environments.
4. **No Secrets in Repository:** Ensured `.env.test.example` contains only empty values and comments. No `.env` or credentials were created or committed.
