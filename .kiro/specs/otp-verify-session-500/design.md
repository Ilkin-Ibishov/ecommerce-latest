# OTP Verify Session 500 — Bugfix Design

## Overview

`POST /api/auth/otp/verify` returns `HTTP 500 {"error":"Internal server error"}`
on the Railway production deployment, blocking all customer logins. The generic
body is emitted by the central `errorHandler` (`src/middlewares/errorHandler.ts`),
which only fires for **unhandled** throws — the handler's own failure branches
return specific messages. Therefore the verify handler throws somewhere in the
user-resolution / session-issuance block of `routes/auth.ts`, after `verifyOTP`
returns `{valid:true}`.

The fix approach is two-part and must be guided by an exploration step that
captures the **exact** stack trace before any code changes are designed in detail:

1. **Confirm the throw** (exploration). Reproduce locally and/or via Railway logs,
   capturing the precise throwing line. If it does **not** reproduce locally, that
   is itself strong evidence the Railway box runs a **stale build** — which becomes
   the recorded root cause, and the fix becomes "redeploy + add a regression guard."
2. **Harden the handler** so that, under the bug condition, it either succeeds
   (issues a session) or fails with a **specific handled error** — never a raw
   throw — while fixing the underlying cause (phone-format normalization on the
   `users` lookup, null-guarding the `listUsers` destructure, and robust session
   issuance). The already-working path (`existingRow` found) must be preserved.

This design follows the project's Express 5 conventions: async errors auto-forward
to `errorHandler` (no try/catch merely to return 500); `res.status().json(); return;`
(never `return res.json()`); handlers annotated `Promise<void>`; logging via
`req.log` (never `console.log`).

## Glossary

- **Bug_Condition (C)**: `POST /auth/otp/verify` receives a valid (or test-bypass)
  code for a phone whose Supabase Auth user already exists but whose `public.users`
  row is **not** matched by the `eq("phone", phone)` lookup, driving the handler
  into the create/recover branch where it throws an unhandled exception.
- **Property (P)**: For a bug-condition input the fixed handler returns `200` with
  `access_token`/`refresh_token`, OR a specific handled error — never an unhandled
  throw / generic 500.
- **Preservation**: The already-working verify path (`existingRow` found →
  `updateUserById` → `signInWithPassword`) still issues a valid session; the 400
  validation branches, `healthz`, and all other routes are unchanged.
- **verifyHandler**: The `POST /auth/otp/verify` route handler in
  `artifacts/api-server/src/routes/auth.ts`.
- **verifyOTP**: `lib/otp.ts` function that validates the code; returns `{valid:true}`
  immediately for `TEST_PHONES` + `TEST_CODE` (999999) before any DB/WhatsApp work.
- **errorHandler**: Central Express error middleware (`src/middlewares/errorHandler.ts`)
  that logs `err.message`/`err.stack` via `req.log` and returns the generic
  `{ error: "Internal server error" }`.
- **existingRow**: Result of `admin.from("users").select("id").eq("phone", phone).maybeSingle()`.
  Null when no `public.users` row matches the queried phone string.
- **F / F'**: Original (unfixed) handler / fixed handler.

## Bug Details

### Bug Condition

The bug manifests when a verify call resolves to a valid code but the
`public.users` lookup fails to match an Auth user that actually exists. The
handler then enters the create branch; `createUser` errors because the auth user
already exists; the recovery path destructures a possibly-null `listUsers` result
and throws a `TypeError`, which the central `errorHandler` reports as a generic
500. A stale Railway build predating a local fix is an alternative root cause that
exploration must confirm or refute.

**Formal Specification:**

```pascal
FUNCTION isBugCondition(input)
  INPUT: input of type VerifyRequest { phone: string, code: string }
  OUTPUT: boolean

  RETURN codeIsValidOrTestBypass(input.code, input.phone)
         AND authUserExists(input.phone)
         AND NOT publicUsersRowMatchedByLookup(input.phone)
         AND sessionIssuanceBlockThrowsUnhandled(input)
END FUNCTION
```

### Examples

- `POST /auth/otp/verify {"phone":"+994550000001","code":"999999"}` → **actual:**
  `500 {"error":"Internal server error"}`; **expected:** `200` with tokens (the
  test-bypass phone must yield a session) or a specific handled error.
- Phone stored in `public.users.phone` as `994550000001` (no `+`) while the lookup
  queries `+994550000001` → `existingRow` is null → create branch → `createUser`
  conflict → `listUsers` destructure throws.
- Two `public.users` rows share the same phone → `.maybeSingle()` throws on
  multiple rows → unhandled throw (alternative candidate to confirm).
- Already-linked user (`existingRow` found) → **expected unchanged:** `200` with a
  valid `access_token`/`refresh_token` pair.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- The already-working verify path (`existingRow` found → `updateUserById` →
  `signInWithPassword`) must continue to return `200` with valid tokens.
- The `400 {"error":"Verification failed", reason}` branch for invalid/expired
  codes must be unchanged.
- The `400 {"error":"Phone and code are required"}` branch for missing fields must
  be unchanged.
- `GET /api/healthz` and all non-verify routes must be unaffected.
- Re-verify for an already-linked user must remain idempotent.

**Scope:**

All inputs that do NOT satisfy the bug condition must be completely unaffected by
this fix. This includes:

- Valid verify for an already-linked user (the happy path).
- Invalid / expired / missing-field requests (the 400 branches).
- Every other API route and middleware.

**Note:** The expected correct behavior for bug-condition inputs is defined in the
Correctness Properties section (Property 1). This section focuses on what must NOT
change.

## Hypothesized Root Cause

Based on the gathered evidence, the most likely issues are, in priority order:

1. **Null `listUsers` destructure (leading hypothesis)**: In the `createErr`
   recovery branch,
   `const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 })`
   destructures `data.users` directly. If `data` is null/undefined (error response
   shape, SDK version difference, or rate/permission edge), the nested destructure
   raises a `TypeError` → unhandled throw → generic 500.

2. **Phone-format mismatch on the `users` lookup**: `public.users.phone` stored
   without the leading `+` (or otherwise normalized differently) than the queried
   `phone`, so `existingRow` is null for a user that actually exists. This is what
   drives execution into the fragile create/recover branch in the first place.
   Normalization is inconsistent across `createOTP`/`verifyOTP`/the `users` lookup.

3. **`.maybeSingle()` on duplicate phone rows**: If more than one `public.users`
   row matches the phone, `.maybeSingle()` throws instead of returning a row.

4. **Stale Railway build**: The production deployment may predate a local fix; the
   identical code path succeeds from localhost against the same Supabase project.
   If the bug does **not** reproduce locally on the current source, the root cause
   is the stale deployment and the fix is "redeploy + regression guard."

5. **`upsert(..., {onConflict:"id"})` correctness**: Conflict resolution keyed on
   `id` may not reconcile a pre-existing row keyed by `phone`, leaving the
   `public.users` row perpetually unmatched on subsequent lookups.

Exploration (Testing Strategy below) MUST capture the exact throwing line to
confirm or refute hypotheses 1–3 before the implementation detail is finalized.

## Correctness Properties

Property 1: Bug Condition — Verify Never Throws Unhandled Under Format/Recover Edge

_For any_ verify request where the bug condition holds (`isBugCondition` returns
true: valid/test-bypass code, Auth user exists, `public.users` row not matched by
the lookup), the fixed `verifyHandler` SHALL respond with `HTTP 200` including
non-null `access_token` and `refresh_token`, OR with a specific handled error
response, and SHALL NOT raise an unhandled exception that surfaces as the generic
`{"error":"Internal server error"}`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Already-Linked Verify and Validation Branches Unchanged

_For any_ verify request where the bug condition does NOT hold (already-linked user
with a matched `public.users` row, invalid/expired code, or missing fields), the
fixed code SHALL produce the same observable result as the original code:
`200` with a valid session for the happy path, `400 {"error":"Verification failed", reason}`
for invalid/expired codes, and `400 {"error":"Phone and code are required"}` for
missing fields — preserving all existing non-bug behavior including `healthz` and
other routes.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming the root-cause analysis is confirmed by exploration. Application code is
**not** written as part of this spec — the following describes the intended change
surface for the implementation phase.

**File**: `artifacts/api-server/src/routes/auth.ts`

**Handler**: `POST /auth/otp/verify`

**Specific Changes**:

1. **Null-guard the `listUsers` recovery**: Replace the direct nested destructure
   with a guarded read:
   ```ts
   const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
   if (listErr || !listData?.users) {
     req.log.error({ err: listErr }, "[OTP Verify] listUsers recovery failed");
     res.status(500).json({ error: "Session creation failed", detail: listErr?.message });
     return;
   }
   const found = listData.users.find((u) => u.phone === normalizedPhone);
   ```
   This converts a raw `TypeError` into a specific handled error (Express 5: no
   try/catch needed for the auto-forwarded path; the explicit guard returns a
   specific message instead of the generic 500).

2. **Normalize phone consistently**: Introduce a small pure helper (e.g.
   `normalizePhone(phone)` enforcing the canonical `+994XXXXXXXXX` form used by
   `validateAzPhone`) and apply it uniformly to the `users` lookup, the
   `createUser`/`upsert` writes, and the `listUsers` match, so a stored-vs-queried
   format difference can no longer cause a false `existingRow = null`.

3. **Match `listUsers` on normalized phone**: Compare `u.phone` against the
   normalized phone (Auth stores phones without `+`; account for that in the
   comparison) so an existing Auth user is reliably found in the recovery branch.

4. **Confirm `.maybeSingle()` safety**: If duplicate `public.users` rows by phone
   are possible, switch the lookup to an ordered `limit(1)` select (or dedupe) so
   the lookup cannot throw on multiple rows.

5. **Robust session issuance**: Keep the existing
   `updateUserById` → `signInWithPassword` flow and its specific `500`
   `{"error":"Session creation failed", ...}` returns; ensure every failure path in
   the user-resolution block returns a specific handled error rather than throwing.

6. **If exploration refutes a code cause (stale build)**: No handler logic change
   is required for the root cause; instead redeploy the current build to Railway
   and add a regression guard (the Property 1 test) so a stale/divergent deploy is
   caught by CI going forward.

All edits MUST follow Express 5 conventions: annotate the handler `Promise<void>`,
use `res.status().json(); return;`, and log via `req.log` (never `console.log`).

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate the bug on the UNFIXED
code (and capture the exact stack trace), then verify the fix succeeds and
preserves existing behavior. Tests live under `artifacts/api-server/tests/` and are
tagged Fix-Checking vs Preservation. Optional/test-only tasks use the `- [ ]* N.M`
convention. An env toggle in the style of the existing SEC specs
(`SEC001_FIXED` / `P1_FIXED`) MAY be used so the same exploration test runs first
as a counterexample (UNFIXED) and later as a fix-check (FIXED).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the
fix, and **capture the exact throwing line/stack trace** to confirm or refute the
root-cause hypotheses. If we refute them, re-hypothesize.

**Test Plan**: Reproduce via whichever avenue is available:

- **Local reproduction (preferred)**: Boot the api-server locally against the repo
  root `.env` (it builds clean to `dist/index.mjs`), `POST` the test-bypass phone
  (`+994550000001` / `999999`) to the local `/api/auth/otp/verify`, and capture the
  thrown error + stack via the server logs (`errorHandler` logs `err.stack` through
  `req.log`). Note: with `NODE_ENV` unset (dev), `verifyOTP`/`createOTP` use the
  in-memory path, but the `TEST_PHONES` bypass still returns valid and the
  session-issuance block runs identically — so a code-related bug should reproduce
  locally. If it does **not** reproduce locally, record that as strong evidence of a
  **stale Railway build** (root cause = deployment, fix = redeploy + guard).
- **Railway logs**: If Railway access (`railway login`) or pasted deploy logs are
  available, read the stack trace directly.

Also write a unit-level exploration (vitest, no DB) that drives the handler's
user-resolution/session-issuance logic with `getAdminSupabase`/`getSupabase`
mocked so `existingRow` is null, `createUser` returns an "already exists" error,
and `listUsers` returns `{ data: null }` — asserting that the UNFIXED code throws
(the `TypeError`) rather than returning a handled response.

**Test Cases**:
1. **Test-bypass live/local repro**: `POST` `+994550000001`/`999999` → expect `500`
   on unfixed code; capture stack trace (will fail to return tokens).
2. **Null-`listUsers` unit case**: mocked recovery branch with `data:null` → expect
   unhandled `TypeError` on unfixed code.
3. **Format-mismatch case**: `public.users.phone` stored without `+` → `existingRow`
   null → create/recover branch entered (will fail on unfixed code).
4. **Duplicate-row edge**: two `users` rows by phone → `.maybeSingle()` throws (may
   fail on unfixed code).

**Expected Counterexamples**:
- `POST /auth/otp/verify {"phone":"+994550000001","code":"999999"}` → `500`
  generic body instead of tokens.
- Captured stack trace pointing at the `listUsers` destructure (or `.maybeSingle()`).
- Possible causes: null `listUsers.data` destructure, phone-format mismatch,
  duplicate rows, or stale deployed build.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed
handler produces the expected behavior (200 + tokens, or a specific handled error).

**Pseudocode:**
```pascal
FOR ALL input WHERE isBugCondition(input) DO
  result := verifyHandler_fixed(input)
  ASSERT (result.status = 200 AND result.access_token ≠ null
                              AND result.refresh_token ≠ null)
         OR (result IS specific handled error AND NOT unhandledThrow(result))
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the
fixed handler produces the same result as the original.

**Pseudocode:**
```pascal
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT verifyHandler_original(input) = verifyHandler_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation
because it generates many inputs across the domain (assorted valid/invalid/missing
combinations and phone shapes), catches edge cases manual tests miss, and gives
stronger guarantees that non-bug behavior is unchanged.

**Test Plan**: Observe behavior on UNFIXED code first for the happy path and the
400 branches, then write tests (unit + property) capturing that behavior and assert
it is preserved after the fix.

**Test Cases**:
1. **Happy-path session preservation**: already-linked user (`existingRow` found) →
   `200` with valid `access_token`/`refresh_token`; observe on unfixed code, assert
   unchanged after fix.
2. **Invalid/expired code preservation**: `400 {"error":"Verification failed", reason}`
   — observe then assert unchanged.
3. **Missing-field preservation**: `400 {"error":"Phone and code are required"}` —
   observe then assert unchanged.
4. **Idempotent re-verify preservation**: re-verify for a linked user still issues a
   fresh valid session.

### Unit Tests

- Verify handler user-resolution/session-issuance logic with `getAdminSupabase`/
  `getSupabase` mocked: assert **no unhandled throw** under the null-`existingRow` /
  null-`listUsers` cases, and that a specific handled error is returned on genuine
  failure.
- `normalizePhone` pure-function tests if the helper is introduced (canonical
  `+994XXXXXXXXX` form; idempotent; matches `validateAzPhone`).
- Validation-branch unit tests (missing fields, invalid code) remain green.

### Property-Based Tests

- Generate assorted phone shapes / `existingRow` states and assert the fixed
  handler never throws unhandled under the bug condition (Fix-Checking).
- Generate non-bug inputs (valid linked user, invalid/expired code, missing fields)
  and assert observed behavior is preserved across the domain (Preservation).

### Integration Tests

- CI `integration-e2e` job (real Supabase + service key): `POST /auth/otp/verify`
  with the test-bypass phone returns `200` + tokens; re-verify is idempotent.
- Confirm `GET /api/healthz` and a sample of other routes are unaffected.
- These run as a no-op locally unless the Supabase keys + running server are present
  (mirrors the existing SEC integration-test conventions).
