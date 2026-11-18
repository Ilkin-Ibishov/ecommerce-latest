# Archived from docs/STATUS.md — 2026-11-18 afternoon

Verbatim. The "Start here" block written at the end of the 2026-11-18 morning session and
corrected during the afternoon one (no production project; git mechanics delegated). **Superseded**:
read `docs/STATUS.md` for current state. Kept so nothing is lost, not to be read at session start.

## Start here — first thing to do in a new session (2026-11-18, morning)

**`main` is green at `ce61f7c`: CI runs 44286363216 (`Architectural invariants`: 21 checks,
indexes current) and 44286363317 (`Test`: `unit` and `integration-e2e` both success — 69 unit
files, 54 component, 110 integration files, 42 E2E passed and 1 skipped, no flaky).** Nothing is
in flight: no builder, no sub-agent, no other work queued.

```bash
gh run list -b main -L 2 --json databaseId,name,conclusion   # expect success on both
git fetch -q origin && git log --oneline -3 origin/main
```

The one skip is permanent and declared: `tests/e2e/super-admin-platform.spec.ts:4` skips itself
unless `SUPER_ADMIN_E2E` is set, so a green E2E run is **43 tests, 42 passed, 1 skipped**. Any
"no skips" wording in older handoffs is wrong about that one.

**Read `.claude/skills/session-start/SKILL.md` for your role.** `docs/agent-workflow.md` holds the
process detail and the lessons; read it when you need it, not up front.

### Do this first, in this order

**There is no production project** (owner, 2026-11-18: not created yet; the `vercel.json` hosts
are gone — `docs/knowledgebase/supabase-projects.md`). `ecommerce-warehouse` is the only database.
Older notes and specs that ask about "production" describe a database that does not exist yet.

1. **`fix/otp-bypass-production` (`fef34e1`) — security; must merge before anything is hosted.**
   `artifacts/api-server/src/lib/otp.ts:13-18` hardcodes three phones and the code `999999`, and
   its own comment says they "accept TEST_CODE in any environment". In `verifyOTP` the bypass is
   checked at `:120`, **before** the `IS_DEV` branch, so it would be live on any deployment;
   `checkRateLimit` (`:71`) also exempts those phones everywhere. On the test project **two of
   those three hold `admin` and `staff`** (`docs/design-notes/staff-provisioning.md` §1). Not
   exposed today, because nothing is hosted. Rebase the branch onto `main` (far behind), open a
   PR, merge. It turns the bypass and the rate-limit exemption off where `NODE_ENV=production`.
2. **Review `docs/design-notes/staff-provisioning.md`** (`design/staff-provisioning`, `d471185`).
   It blocks M4b: `AdminLayout.tsx:105-107` admits `role === "admin"` only, so staff cannot enter
   the admin UI at all and M4b's staff filter would be unreachable code. It also found a live
   defect on `main` — `routes/auth.ts:98-102` upserts `role: "customer"` when the lookup by
   canonical phone misses, which **demotes a legacy-format staff or admin row on sign-in**. One
   line fixes it.
3. **Write the design note for `docs/tasks/delivery-cost-at-confirmation.md`.** The spec is
   complete; the note is the next artifact. Its §9.3 (`NOT VALID` constraint for existing
   production rows) and §9's backfill question assume a production database — with none, the note
   should say so and propose the constraint for the test project and a fresh production. New
   work, so it waits behind 1-2.

### What this session put on `main`

New: `docs/tasks/delivery-cost-at-confirmation.md` (`44c74e7`, `d9f7bf3`) — the delivery amount is
agreed on the confirmation call, the fee column is nullable with three states, and recording it is
mandatory before the goods move. No open questions in it.

Fixed: `bf9e7bc`, the admin Inventory E2E block, which had been green by accident.

Removed: all of `.kiro/` and `ltm/` (`ad17c6d`, `7092a8a`, `bdf7a46`), 1.35 MB of dead tooling, on
the owner's yes. Recovery refs in `docs/agent-workflow.md`.

The earlier part of this session — the agent-context-modularization note implemented in full,
items A-F, which cut session start from ~133 KB / ~37,000 tokens to `AGENTS.md` plus this file
plus the one spec the task needs — is in `docs/archive/status/2026-11-18-morning.md`.
