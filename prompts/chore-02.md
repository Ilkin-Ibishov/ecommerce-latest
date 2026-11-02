# Chore batch 02 — make the test suite runnable

Read `AGENTS.md` and `.agents/rules/testing.md` first. Work on the branch you are on; never commit
to `main`. Two tasks, **committed separately**.

Context: M1 is a refactor of the data spine, and its entire correctness argument rests on tests
actually running. Right now the gating CI job is red and a fresh clone cannot run the suite at all.
Both are fixed here, before M1 starts.

**Scope discipline:** `.github/workflows/test.yml` is already well structured — a no-secrets `unit`
gate and a secrets-bearing `integration-e2e` job. **Do not redesign it.** If you believe something
there is wrong, say so in your notes rather than changing it.

---

## Task 1 — fix the failing `store-unit` tests

`pnpm exec vitest --run --project store-unit` currently fails with:

```
TypeError: React.act is not a function
  exports.act  react-dom/cjs/react-dom-test-utils.production.js:20:16
  @testing-library/react/dist/act-compat.js:46:25
```

at least in `artifacts/store/src/__tests__/login-modal-profile-reroute.test.ts:134`. Five tests fail
this way.

**Why it matters:** `store-unit` is the job that gates every push to `main`. While it is red, CI
tells you nothing, and the first thing M1 breaks will look identical to the thing that was already
broken.

**Diagnose before changing anything.** This is a React 19 / testing-library compatibility problem:
`react-dom/test-utils`' `act` was removed in React 19 and `act` now lives on `react` itself. Find out
which layer is reaching for the old one — the installed `@testing-library/react` version, a direct
import in the test, or a transitive `react-dom/test-utils` usage. Check the installed versions
before assuming.

Fix the cause. **Do not** skip the tests, loosen their assertions, or stub out the component — those
are denied in `AGENTS.md`. If the only correct fix is a dependency upgrade, do that and say what it
changes. If you conclude the test itself asserts something unreasonable, say so in your notes and
stop rather than rewriting it.

---

## Task 2 — let a fresh clone run what does not need a database

Today `pnpm test` runs every vitest project. In a clone without a root `.env`,
`artifacts/api-server/tests/setup.ts` throws on missing `SUPABASE_URL` and the other required vars,
so **101 of 130 test files die at collection** — they never run, and the output buries the 5 real
failures among 101 environmental ones. A developer or agent cannot tell signal from noise.

**What to do:**

1. Add scripts to the root `package.json`:
   - `test:unit` — the tiers that need nothing external (currently `store-unit`; check whether any
     api-server project qualifies)
   - `test:integration` — the tiers that need Supabase credentials and a running API server
   - keep `test` running everything, so CI and a fully configured machine are unchanged
2. `setup.ts` already tells the user the variables may live in `.env` **or** `.env.test`, but only
   loads `.env`. Make it load both, `.env.test` taking precedence. Small fix, currently a lie.
3. Commit a `.env.test.example` listing every variable the integration tier needs, with empty
   values and a one-line comment each. **No real values, ever.**
4. Add a short section to `.agents/rules/testing.md` recording which command runs which tier, so
   future agents stop claiming `pnpm test` passed when it cannot.

**Explicitly not in scope:** making the integration tier run without credentials. A test that
silently passes without its database is worse than one that fails loudly. The split is about making
the *runnable* tier runnable, not about faking the rest.

---

## When you are done

Report the real output of `pnpm run typecheck`, `pnpm run test:unit` and
`pnpm run audit:invariants` — the actual terminal output, not a summary of what you expect. Say
plainly which tiers you could not run and why.

Write `docs/audits/chore-02-notes.md`: what changed per task, what you found that contradicts this
prompt, and what you chose not to do. Your work is reviewed from the git diff by someone who will
not see this conversation.
