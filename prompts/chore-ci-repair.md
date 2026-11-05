# Chore — make the CI integration tier able to run again

Two small, exact changes. Nothing else. Prescriptive: implement as written, do not refactor
anything nearby, do not touch the unit job.

Branch from `main`. One commit per item.

---

## 1. `SESSION_SECRET` is missing from the integration job

`.github/workflows/test.yml`, the `integration-e2e` job, step **"Start API server"**. Its `env:`
block sets `PORT`, `NODE_ENV` and `E2E_DISABLE_AUTH_RATELIMIT`, but not `SESSION_SECRET`.

`artifacts/api-server/src/index.ts` (around line 20) refuses to start when `SESSION_SECRET` is unset
or shorter than 32 characters — correct behaviour, added in M1. So the API server cannot start in CI,
the "Wait for API health endpoint" step times out, and none of the integration tests run.

Add to that step's `env:` block only:

```yaml
          SESSION_SECRET: ${{ secrets.SESSION_SECRET }}
```

Do not add it to the `unit` job — that job starts no server. Do not add a fallback literal; a missing
secret must fail loudly rather than start the server with a weak key.

## 2. A stale assertion is the only thing that failed the last CI run

`artifacts/api-server/tests/otp-verify-500.exploration.test.ts`, around line 183:

```
Expected: "Internal server error"
Received: "Session creation failed"
```

The API's error message changed; the exploration test still asserts the old string. The run on
2026-07-01 passed every other integration test (54 passed) and failed only on this.

Update the assertion to the message the code actually returns. Read the route that produces it and
assert the current string — do not loosen the assertion to a substring match or a regex, and do not
skip the test.

If the current message is produced in more than one place and you cannot tell which one this test
exercises, say so in your notes and leave the test failing rather than guessing.

---

## Definition of done

- `pnpm run typecheck` and `pnpm run audit:invariants:strict` green
- `pnpm run test:unit` green
- `git diff main...HEAD` touches exactly two files
- `docs/audits/chore-ci-repair-notes.md` written: both changes, and the real output of the commands

You cannot run the integration tier locally — it needs Supabase credentials and a running server, and
that is the whole point of this chore. Do not claim it passes. Say plainly which tiers you ran.

Do not run migrations against any remote Supabase project. Do not push.
