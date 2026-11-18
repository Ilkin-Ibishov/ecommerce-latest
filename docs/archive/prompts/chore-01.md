# Chore batch 01 — security fix, dead tree removal, stale document headers

Read `AGENTS.md` first. You are on branch `chore/batch-01`, branched from
`chore/agent-workflow-phase0`. Never commit to `main`.

This is housekeeping that must land **before** the M1 inventory work starts, so that the M1 diff
stays readable. Three independent tasks. **Commit each one separately** — they must be reviewable
and revertable on their own.

---

## Task 1 — `SESSION_SECRET` has a hardcoded fallback (security, do this first)

`artifacts/api-server/src/routes/auth.ts` around line 111:

```js
const tempPass = createHmac("sha256", process.env.SESSION_SECRET || "fallback-dev-secret")
  .update(userId).digest("hex").slice(0, 32);
```

**Why this matters.** The OTP flow stamps a deterministic email/password pair on the user so it can
call `signInWithPassword`. The login email is derived from the phone number and the password from
`HMAC(SESSION_SECRET, userId)`. `SESSION_SECRET` appears nowhere else in the codebase — there is no
startup assertion and no entry in any env schema. If it is unset in a deployed environment the key
is the string literal above, which is in the source. Anyone who knows a user's phone number and
their `userId` (a value that travels in comments, orders and logs) can then authenticate as that
user without an OTP, including an admin.

**What to do:**
1. Remove the `|| "fallback-dev-secret"` fallback entirely. There must be no default.
2. Add a startup assertion so the process **refuses to start** if `SESSION_SECRET` is missing or
   obviously weak (say, shorter than 32 characters). Put it wherever this codebase already validates
   environment configuration — look for existing env-validation code and follow that pattern rather
   than inventing a new one. There are existing env-validation tests; extend them.
3. Add a test that the derivation throws or the startup check fails when the variable is absent.

**Do not:** generate, write, commit or print a secret value. Do not touch `.env` files. Rotating
the live secret is the owner's job and will be done outside this repository. If you think the
derivation scheme itself should change, say so in the commit message — do not redesign the auth
flow in this chore.

---

## Task 2 — delete `.migration-backup/`

103 MB and 527 tracked files — roughly 40% of everything tracked in this repository. It is a
complete second copy of the source tree, including its own `package.json`, `pnpm-workspace.yaml`
and `replit.md`.

For a codebase worked on by agents this is not untidiness, it is a correctness hazard: every search
returns duplicate hits from a dead tree, and a file can be read or edited in the wrong copy without
anyone noticing.

**What to do:**
1. First confirm nothing live references it: search the repo for `migration-backup` in source,
   config, scripts and CI. **If anything does, stop and report instead of deleting.**
2. `git rm -r --cached` plus removal from the working tree, or plain `git rm -r` — your call.
3. Add it to `.gitignore` so it cannot come back.
4. Confirm `pnpm run typecheck` and `pnpm test` still pass afterwards.

The content stays in git history, so this is reversible. That is why it is safe.

---

## Task 3 — mark three documents as stale

Agents read these and act on them. All three currently misrepresent the state of the codebase.

- `SECURITY_AUDIT.md` and `security-report.md` — SEC-001, SEC-002, SEC-003, SEC-004 and the RLS
  findings are **already remediated**, with preservation tests in `artifacts/api-server/tests/`.
  Read the files, check each finding against the tests and migrations that exist, and add a status
  header at the top of each stating which findings are resolved and which remain open. Do not delete
  the documents and do not rewrite the findings themselves.
- `docs/tasks/backlog.md` — partly stale; H2, H3 and most of H4 are done. Verify each item against
  the code before marking it, and add a dated header saying when it was last verified.

**Verify, do not assume.** If you cannot confirm an item's state from the code, mark it "unverified"
rather than guessing. A confidently wrong status header is worse than the stale document.

---

## When you are done

`pnpm run typecheck`, `pnpm test` and `pnpm run audit:invariants` must all pass. Report the real
output, not a summary of what you expect.

Write a short `docs/audits/chore-01-notes.md` listing what you changed per task, anything you found
that contradicts this prompt, and anything you chose not to do and why. Your work is reviewed from
the git diff by someone who will not see this conversation.
