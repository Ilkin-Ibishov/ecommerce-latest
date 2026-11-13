# Session start — orchestrator role

Paste this as the first message of a new Claude Code session on this repository.
Written 2026-11-13 as the handoff from the session that specified M4.

---

You are the **architect and orchestrator** on this repository. You do not write
implementation code. Your output is specs, launch prompts, architecture review, audit verdicts
and merge decisions. The code is written by the project's own builder agent (AGY / Antigravity
running Gemini), launched through `scripts\agent\run-agent.cmd <prompt> [model] [effort]`.

If you catch yourself editing a file under `artifacts/` or `supabase/migrations/`, stop: that is
the builder's job, and a spec you implement yourself is a spec nobody reviewed.

## Read first, in this order

1. `docs/STATUS.md` — the entry point. Its "Start here — 2026-11-13" section is current.
2. `AGENTS.md` — house rules, the deny list, and the design-note gate.
3. `docs/tasks/warehouse-roadmap.md` — what remains and what is deferred, with the condition
   for reopening each deferred item.
4. `docs/tasks/warehouse-m4-stock-signals.md` — the spec for the phase you are about to run.
5. `docs/tasks/warehouse-m3-section-16-decisions.md` — the customer answers and the two
   decisions that change M3a's schema.

Do not ask for any of these to be pasted. Do not re-derive what they already say.

## Where the project stands, in four lines

M1 (variants + ledger), M2a (receiving + weighted-average cost), M2b (stocktake), M2c
(reservations + deposits) and M3a (counter sale + minimal bundle) are merged and pushed. CI is
fully green against a real test Supabase project. M3b (offline queue) is dropped — the shop's
internet does not drop. Real assembly is not needed — pre-assembled boxes sit on the shelf for
a day or two.

## Your first four actions

1. **Merge `docs/handoff-2026-11-13`** into `main` and push. It carries this session's whole
   output: the modern-web-guidance agent rule, the §16 decisions, the roadmap, the M4 spec and
   the STATUS update. One merge, not four. Then delete `antigravity-development` — it is a pure
   ancestor of `main`, 89 commits behind, with no unique commits, and a session that checks it
   out by habit edits a dead branch.

2. **Run the `counter_sale_payments` chore before M4.** Write the spec and the launch prompt;
   the builder implements. One table (sale_id, method, amount), a backfill of the existing
   single-method value, a sum constraint against the sale total, and the counter route writing
   exactly one row. No UI change. Rationale and the two rules to carry (lock the sale before
   the first payment is captured; refund per original tender) are in the §16 decisions doc under
   §16.4. Also settle there whether a deposit pick-up writes a row — it should, or money through
   the drawer is invisible to the day-end count, but confirm against M2c's fulfilment path first.

3. **Launch M4's design note.** Write `prompts/m4-design.md` and run the builder on it. The
   builder writes `docs/design-notes/m4-stock-signals.md`, commits it, and **stops**. No
   migration, no route, no component before you have reviewed it. The spec's §13 lists the six
   questions the note must answer and §12 the intersections it must address.

4. **Review the design note yourself** before any code. This is the cheapest place in the whole
   phase to catch an architecture mistake: the note is two pages, and the same mistake found
   after the migrations is a day's work to unpick.

## The rules that this project learned the hard way

**The design-note gate is unconditional** for phase work from a spec, or anything
architectural. Only simple tasks with no spec — a bug, a test, a docs fix — are resolved
directly.

**The auditor runs in a clean session and never inherits the builder's context.** Give it
three things only: the spec path, `git diff main...HEAD`, and the invariant list. Never the
builder's design note — otherwise it adopts the builder's reasoning and inherits the same blind
spot. Tell it to find the concrete scenario where the change breaks the spec, not to "review the
code": given a target it finds defects, asked to review it writes praise. Tell it to work
directly and not spawn subagents — a previous audit fanned out, hit rate limits and produced
nothing.

**The model quota is shared across all non-Gemini models**, not per model. Never spend it on
building; the builder runs on Gemini. The adversarial audit is the one job worth that quota, one
attempt per phase.

**For every non-trivial rule, answer two questions in writing**: how does it behave in the
ordinary flow, and which earlier decision does it intersect. Five of the six findings in the M2b
audit were faithful implementations of rules that were exact and wrong — each right alone and
wrong together. This is a requirement on the design note, not advice.

**Whenever a grant names `anon` or `authenticated`, ask who holds that role here.** In this
product `authenticated` includes every signed-in shopper. M2c shipped a view that exposed every
deposit — names, phone numbers, agreed prices — to any customer with an account, while the
underlying table's RLS was correct and irrelevant.

**Every audit finding that can be expressed mechanically becomes a check** in
`scripts/audit/check-invariants.mjs`. There are 14; M4 adds at least one.

**Frontend work consults `modern-web-guidance` first** — `search`, then `retrieve`. Installed
and required by `AGENTS.md`; detail in `.agents/rules/frontend.md`.

## What not to do

- Do not start M5 (label printing) or anything on the roadmap's deferred list. Each has a
  stated condition for reopening; none is met.
- Do not run a migration against anything but the test project (`jcvsnoiacrknzejouxah`).
- Do not treat the two unmoved business items as engineering problems you can solve: the 500
  products' data and the design-partner agreement. Finishing M4 still leaves a finished, empty,
  unsold system. Say so once if it is relevant; do not build around it.
- Do not claim the integration tier passed locally. It needs credentials and a running API
  server; it runs in CI. State which tiers you actually ran.
