# Implementation Plan: OTP Verify Session 500

## Overview

This plan fixes the production `POST /api/auth/otp/verify` `HTTP 500` using the
bug-condition methodology: **explore** (reproduce the defect on unfixed code and
capture the exact stack trace), **preserve** (capture `¬C` behavior that must not
change — the already-linked happy path and the 400 validation branches),
**implement** (harden the user-resolution / session-issuance block), **validate**
(Fix-Checking + Preservation).

- The generic `{"error":"Internal server error"}` is the central `errorHandler`'s
  output, so the handler **throws** an unhandled exception after `verifyOTP`
  returns valid. Exploration must pin the exact throwing line before the fix is
  finalized — leading hypothesis is the null `listUsers` destructure in the
  `createUser` "already exists" recovery branch, driven by a phone-format mismatch
  on the `users` lookup. A stale Railway build is an alternative root cause.
- Test-only / optional tasks use the repo `- [ ]* N.M` convention.
- Tests are tagged to the design Property they validate and to their role
  (Fix-Checking vs Preservation).
- 3-layer testing: unit/property (vitest, no DB) with `getAdminSupabase`/
  `getSupabase` mocked; RLS/integration (CI `integration-e2e`, real Supabase +
  service key) where the live verify flow is the assertion.
- Express 5 conventions throughout: handler annotated `Promise<void>`,
  `res.status().json(); return;` (never `return res.json()`), logging via `req.log`
  (never `console.log`), no try/catch merely to return a generic 500.
- **Non-goal:** the Vercel `405` on this route (that project serves the storefront
  SPA, not the API) is out of scope.

---

## Tasks

- [x]* 1. Write bug condition exploration test (capture the exact throw)
  - **Property 1: Bug Condition** - Verify Never Throws Unhandled Under Format/Recover Edge
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples AND capture the exact throwing line/stack trace to confirm/refute the root-cause hypotheses (null `listUsers` destructure, phone-format mismatch, `.maybeSingle()` duplicate-row, or stale Railway build)
  - **Scoped PBT Approach**: For this deterministic bug, scope the property to the concrete failing case(s): test-bypass phone `+994550000001` with code `999999`, and a mocked unit case where `existingRow` is null, `createUser` returns an "already exists" error, and `listUsers` returns `{ data: null }`
  - Reproduction avenues (prefer whichever is available):
    - **Local repro**: boot api-server against repo root `.env` (builds clean to `dist/index.mjs`), `POST` `+994550000001`/`999999` to local `/api/auth/otp/verify`, capture thrown error + stack from server logs (`errorHandler` logs `err.stack` via `req.log`). If it does NOT reproduce locally, RECORD this as strong evidence of a STALE Railway build (root cause = deployment) per design.md
    - **Railway logs**: if `railway login` access or pasted deploy logs are available, read the stack trace directly
  - Unit-level exploration (vitest, no DB): mock `getAdminSupabase`/`getSupabase` so the recovery branch destructures null `listUsers.data`; assert the UNFIXED handler throws (TypeError) instead of returning a handled response
  - Place under `artifacts/api-server/tests/` (e.g. `otp-verify-500.exploration.test.ts`); MAY use an `OTP_VERIFY_FIXED` env toggle in the style of the SEC `SEC001_FIXED` / `P1_FIXED` tests so the same test serves exploration (UNFIXED) then fix-check (FIXED)
  - The test assertions should match Property 1 in design.md (200 + tokens OR a specific handled error; never an unhandled throw / generic 500)
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document the captured counterexample and stack trace to pin the root cause
  - Mark task complete when the test is written, run, and the failure + stack trace are documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x]* 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Already-Linked Verify and Validation Branches Unchanged
  - **IMPORTANT**: Follow observation-first methodology - observe behavior on UNFIXED code, then encode it
  - Observe on UNFIXED code:
    - Already-linked user (`existingRow` found) → `200` with valid `access_token`/`refresh_token`
    - Invalid/expired code → `400 {"error":"Verification failed", reason}`
    - Missing `phone`/`code` → `400 {"error":"Phone and code are required"}`
    - Re-verify for a linked user → fresh valid session (idempotent)
  - Write property-based tests (vitest, `getAdminSupabase`/`getSupabase` mocked for the unit layer) generating assorted non-bug inputs and asserting the observed outputs are preserved across the domain (from Preservation Requirements in design.md)
  - Place under `artifacts/api-server/tests/` (e.g. `otp-verify-500.preservation.property.test.ts`); tag as Preservation
  - Property-based testing generates many cases for stronger guarantees that non-bug behavior is unchanged
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for OTP verify 500 (unhandled throw in user-resolution / session-issuance)

  - [x] 3.1 Implement the fix in `routes/auth.ts` (or redeploy if exploration proved a stale build)
    - Null-guard the `listUsers` recovery: read `{ data: listData, error: listErr }`, return a specific handled `500 {"error":"Session creation failed", detail}` (logged via `req.log`) when `listErr || !listData?.users`, instead of destructuring a possibly-null `data`
    - Introduce a `normalizePhone(phone)` pure helper (canonical `+994XXXXXXXXX`, idempotent, consistent with `validateAzPhone`) and apply it uniformly to the `users` lookup, `createUser`/`upsert` writes, and the `listUsers` match
    - Match `listUsers` on the normalized phone (account for Auth storing phones without `+`)
    - Confirm `.maybeSingle()` safety: if duplicate `users` rows by phone are possible, switch to an ordered `limit(1)` select (or dedupe) so the lookup cannot throw
    - Keep the existing `updateUserById` → `signInWithPassword` flow and its specific `500 {"error":"Session creation failed", ...}` returns; ensure every failure path returns a specific handled error rather than throwing
    - If exploration (task 1) proved a STALE BUILD with no local repro: redeploy the current build to Railway and rely on the task-1 regression guard instead of changing handler logic
    - Follow Express 5 conventions: annotate handler `Promise<void>`, use `res.status().json(); return;` (never `return res.json()`), log via `req.log` (never `console.log`); do NOT add try/catch merely to return a generic 500
    - _Bug_Condition: isBugCondition(input) from design.md (valid/test-bypass code, Auth user exists, public.users row not matched by lookup)_
    - _Expected_Behavior: Property 1 - 200 + tokens OR a specific handled error; never an unhandled throw_
    - _Preservation: Preservation Requirements from design.md (happy path, 400 branches, healthz, idempotent re-verify)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Verify Never Throws Unhandled Under Format/Recover Edge
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test (flip the `OTP_VERIFY_FIXED` toggle to FIXED if used)
    - The test from task 1 encodes the expected behavior; when it passes it confirms the bug is resolved
    - **EXPECTED OUTCOME**: Test PASSES (confirms the verify path returns 200 + tokens or a specific handled error, never a generic 500)
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Already-Linked Verify and Validation Branches Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions on the happy path, 400 branches, healthz, and idempotent re-verify)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.4 Add CI integration coverage (real Supabase, `integration-e2e` job)
    - `POST /auth/otp/verify` with the test-bypass phone `+994550000001`/`999999` returns `200` + `access_token`/`refresh_token`; re-verify is idempotent
    - Confirm `GET /api/healthz` and a sample of other routes are unaffected
    - No-op locally unless Supabase keys + a running server are present (mirror existing SEC integration-test conventions); place under `artifacts/api-server/tests/` as `*.integration.test.ts`
    - _Requirements: 2.1, 3.4, 3.5_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run `pnpm run typecheck` and the api-server unit suite; ensure all tests pass
  - Confirm Property 1 (fix-check) passes and Property 2 (preservation) still passes
  - Ask the user if questions arise (e.g. exploration refuted the code-cause and pointed at a stale deploy, or required Railway access was unavailable)

---

## Task Dependency Graph

ASCII view (exploration/preservation on unfixed code → fix → validate):

```
EXPLORE / PRESERVE (run on UNFIXED code)
  1* Exploration test (capture stack trace) ──┐
  2* Preservation baseline (must PASS) ────────┤ 1 ∥ 2
                                               ▼
IMPLEMENT
  3.1 Fix routes/auth.ts (or redeploy if stale build)
                                               │
VALIDATE (re-run the SAME tests from 1 & 2)    ▼
  3.2* Fix-check (Property 1 now PASSES) ──┐ depends on 3.1
  3.3* Preservation (Property 2 PASSES) ───┤ 3.2 ∥ 3.3 ∥ 3.4
  3.4* CI integration coverage ────────────┘
                                               ▼
CHECKPOINT
  4  Ensure all tests pass   depends on 3.1–3.4
```

Machine-readable wave definitions (each wave runs after the previous; tasks within a wave may run in parallel):

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 3, "tasks": ["4"] }
  ]
}
```

**Parallelism notes**
- Tasks 1 and 2 are independent and run in parallel on the UNFIXED code: task 1 must FAIL (proves the bug), task 2 must PASS (captures the baseline to preserve).
- Task 3.1 is the single implementation task; it depends on the exploration outcome (the captured stack trace selects between the code-fix path and the stale-build/redeploy path).
- Validation tasks 3.2/3.3/3.4 re-run the SAME tests from tasks 1/2 (plus CI integration) and fan out after 3.1.
- Task 4 is the final gate and depends on every prior task.

---

## Notes

- Tasks marked with `*` are optional / test-only (per the repo convention) and gate quality, not shippability of the fix itself.
- **Exploration-first is mandatory:** write and run the exploration test (task 1) BEFORE implementing the fix, and run it on the UNFIXED code to capture the exact throwing line. Do not implement based on the hypothesis alone.
- **Observation-first preservation:** task 2 records actual UNFIXED outputs for the happy path and the 400 branches, then asserts they are unchanged after the fix.
- **Stale-build branch:** if the bug does not reproduce locally on current source, the recorded root cause is a stale Railway deployment; the fix becomes redeploy + the task-1 regression guard, and task 3.1's handler edits may be unnecessary — flag this to the user at the checkpoint.
- **Auto-deploy caveat:** this repo auto-deploys `main` to production. Land the fix on a feature branch and open a PR rather than pushing to `main`.
- The fix is scoped to the verify user-resolution / session-issuance path in `artifacts/api-server/src/routes/auth.ts` (plus an optional `normalizePhone` helper); no other routes or middleware change.
