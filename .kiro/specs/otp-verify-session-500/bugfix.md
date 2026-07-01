# Bugfix Requirements Document

## Introduction

`POST /api/auth/otp/verify` on the production API server (Railway:
`https://api-server-production-2fcc.up.railway.app/api`) returns
`HTTP 500 {"error":"Internal server error"}`. This blocks **all** customer logins
and is the current launch blocker.

The 500 body is the central `errorHandler`'s generic output, which means the
verify handler **threw an unhandled exception** rather than hitting one of its own
handled failure branches (those return specific messages like
`{"error":"Session creation failed", ...}` or `{"error": createErr.message}`).

Evidence already gathered (treated as established context for this spec):

- **Reproduced live** with the hardcoded test-bypass phone `+994550000001` and
  code `999999` (a `TEST_PHONES` bypass in `lib/otp.ts`) → 500.
- **Server is healthy** (`GET /api/healthz` → 200), so the API boots and
  `SUPABASE_SERVICE_ROLE_KEY` is present (the SEC-006 fail-fast boot assertion
  would otherwise prevent startup). The 500 is **not** a missing-service-key fault.
- The test-bypass phone **skips OTP + WhatsApp entirely** (`verifyOTP` returns
  `{valid:true}` on the first `TEST_PHONES` check, before any DB/WhatsApp call), so
  UltraMsg/WhatsApp and the `otp_requests` table are **ruled out**. The throw is in
  the block **after** `verifyOTP` returns valid: the user find/create + session
  issuance code in `routes/auth.ts` (`admin.from("users").select(...).maybeSingle()`,
  `admin.auth.admin.createUser(...)`, `admin.auth.admin.listUsers(...)`,
  `admin.from("users").upsert(...)`, `admin.auth.admin.updateUserById(...)`,
  `getSupabase().auth.signInWithPassword(...)`).
- The **same GoTrue calls succeed from localhost** against the same Supabase
  project (auth logs show repeated SUCCESS for `994550000001@phoneauth.internal`),
  so this is **not** a GoTrue/Auth-config fault. The production box behaves
  differently — likely a stale deployed build or an environment-specific throw.

The exact throwing line MUST be confirmed by exploration (see design.md), not
assumed. The leading hypothesis is a `users`-lookup phone-format mismatch driving
the create branch, where `createUser` errors (auth user already exists) and the
subsequent `const { data: { users: allUsers } } = await admin.auth.admin.listUsers(...)`
destructures a possibly-null `data` → `TypeError` → unhandled throw → generic 500.

**Out of scope (non-goal):** The Vercel deployment returning `405` on this route
is a **separate** concern (that Vercel project serves the storefront SPA, not the
API) and is not addressed by this spec.

## Bug Analysis

### Current Behavior (Defect)

What currently happens when the bug is triggered.

1.1 WHEN `POST /auth/otp/verify` receives a valid (or test-bypass) code for a
phone whose Supabase Auth user already exists but whose `public.users` row is
**not matched** by the `eq("phone", phone)` lookup (e.g. a stored-vs-queried phone
format mismatch such as `994550000001` vs `+994550000001`) THEN the handler enters
the create branch, `createUser` errors, the `listUsers` destructure throws, and the
system responds with the generic `HTTP 500 {"error":"Internal server error"}`.

1.2 WHEN the `createUser` "already exists" recovery runs
`const { data: { users: allUsers } } = await admin.auth.admin.listUsers(...)` and
the returned `data` is null/undefined THEN the destructure raises an unhandled
`TypeError`, producing a generic 500 instead of a specific handled error.

1.3 WHEN the session-issuance block throws for any reason on the production
deployment (including a stale deployed build predating a local fix) THEN the
failure surfaces as the central `errorHandler`'s generic 500, giving no actionable
detail and blocking the login.

### Expected Behavior (Correct)

What should happen instead.

2.1 WHEN `POST /auth/otp/verify` receives a valid (or test-bypass) code for a
phone whose Auth user exists but whose `public.users` row is not matched by the
lookup THEN the system SHALL resolve the existing user and respond `HTTP 200` with
`access_token` and `refresh_token`, OR respond with a **specific handled** 4xx/5xx
error — never an unhandled throw / generic 500.

2.2 WHEN the `createUser` "already exists" recovery path runs and `listUsers`
returns null/undefined data THEN the system SHALL null-guard the result and either
resolve the user or return a specific handled error, without raising a `TypeError`.

2.3 WHEN the session-issuance block cannot complete THEN the system SHALL return a
specific handled error (e.g. `{"error":"Session creation failed", detail}`) and log
the cause via `req.log`, so the failure is diagnosable rather than a generic 500.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved.

3.1 WHEN `POST /auth/otp/verify` receives a valid code for a phone whose
`public.users` row **is** matched by the lookup (the already-working path:
`existingRow` found → `updateUserById` → `signInWithPassword`) THEN the system
SHALL CONTINUE TO respond `HTTP 200` with a valid `access_token` / `refresh_token`
pair.

3.2 WHEN an invalid or expired code is submitted THEN the system SHALL CONTINUE TO
return `HTTP 400 {"error":"Verification failed", reason}` exactly as before.

3.3 WHEN a request is missing `phone` or `code` THEN the system SHALL CONTINUE TO
return `HTTP 400 {"error":"Phone and code are required"}`.

3.4 WHEN `GET /api/healthz` and all other API routes are called THEN they SHALL
CONTINUE TO behave exactly as before; the fix is scoped to the verify
user-resolution / session-issuance path only.

3.5 WHEN a re-verify occurs for an already-linked user THEN the system SHALL
CONTINUE TO be idempotent and issue a fresh valid session.

---

## Derived Bug Condition and Properties

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type VerifyRequest { phone, code }
  OUTPUT: boolean

  // The handler throws an unhandled exception in the user-resolution /
  // session-issuance block after verifyOTP returns valid.
  RETURN codeIsValidOrTestBypass(X.code, X.phone)
         AND authUserExists(X.phone)
         AND NOT publicUsersRowMatchedByLookup(X.phone)
END FUNCTION
```

### Property: Fix Checking

```pascal
// For all inputs satisfying the bug condition, the fixed handler must not throw.
FOR ALL X WHERE isBugCondition(X) DO
  result ← verifyHandler'(X)
  ASSERT (result.status = 200 AND result.access_token ≠ null
                              AND result.refresh_token ≠ null)
         OR (result IS a specific handled error AND NOT unhandledThrow(result))
END FOR
```

### Property: Preservation Checking

```pascal
// For all inputs NOT satisfying the bug condition, the fixed handler behaves
// identically to the original.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT verifyHandler(X) = verifyHandler'(X)
END FOR
```

**Definitions:**

- **F** — the original (unfixed) `/auth/otp/verify` handler.
- **F'** — the fixed handler.
- **Counterexample** — `POST /auth/otp/verify {"phone":"+994550000001","code":"999999"}`
  returning `500 {"error":"Internal server error"}`.
