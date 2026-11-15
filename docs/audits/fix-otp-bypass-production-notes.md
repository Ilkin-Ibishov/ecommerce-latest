# fix/otp-bypass-production — notes

Owner approved 2026-11-15 ("Waiting on the owner" item 1 in `docs/STATUS.md`).
Simple task, no spec: fixed directly, not by a builder round.

## Change

`artifacts/api-server/src/lib/otp.ts`: `TEST_PHONES` is now empty when `NODE_ENV` is
`production` (the file's existing `IS_DEV` flag). Both bypass sites — `verifyOTP`'s fixed code
`999999` and `checkRateLimit`'s exemption — read only that set, so both are off in production.
Behaviour outside production is unchanged: CI sets `NODE_ENV: development`
(`.github/workflows/test.yml:95`) and the `otp-verify-500.*` tests rely on the bypass there.

Test: `artifacts/store/src/__tests__/otp-bypass-production.test.ts` (store-unit, offline).
It loads `otp.ts` with `NODE_ENV=production` and the Supabase client mocked to "no OTP row";
`verifyOTP("+994550000001", "999999")` must be invalid. A second case checks the bypass still
works under `development`. Run against the old `otp.ts`, the production case fails
(`× OTP test bypass > is rejected in production`); against the fix both pass.

## Blocked / Assumptions / Not verified

- Not known whether any production database has a user on `+994550000001..3`, or what role.
  No access to a production project. If one exists, it can no longer log in after deploy;
  if it holds `staff`/`admin`, the role should be removed by the owner.
- Assumed production deploys set `NODE_ENV=production` (`.replit-artifact/artifact.toml` does;
  the Railway service's variables were not checked). If unset, `IS_DEV` is true and the bypass
  stays on, as do the dev routes (SECURITY_AUDIT.md SEC-011).
- `api-integration` and `env-validation` need Supabase and a running server; not run locally.

## Tests deleted, renamed, moved or weakened

None.

## Command output

`pnpm run typecheck` — exit 0:
```
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

`pnpm test:unit` — exit 0:
```
 Test Files  63 passed (63)
      Tests  698 passed (698)
```

`pnpm run audit:invariants` (tail):
```
ok    no-on-hand-reads-on-storefront   0 total, 0 new
ok    no-sensitive-columns-in-exposed-views 0 total, 0 new
ok    no-client-writes-on-counter-sale-payments 0 total, 0 new
ok    post-counter-sale-writes-payments 0 total, 0 new

All invariant checks passed.
```
