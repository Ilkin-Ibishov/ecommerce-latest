# Launch prompt — M1 build

You are implementing phase M1 of an inventory module in this repository.

Read, in this order:
1. `AGENTS.md` — house rules
2. `.agents/rules/inventory.md` — the domain invariants that outlive this phase
3. `docs/tasks/warehouse-m1-variants-ledger.md` — the work order for M1

Work on the branch you are currently on. Never commit to `main`.

## What this phase is for

The product is a multi-tenant e-commerce platform. Today a product *is* a SKU — it carries price
and a single mutable `stock` integer — and that integer can be overwritten silently by unrelated
code paths. Every later feature (goods receipt, cost and margin, stocktake, counter sales, deposits)
is built on knowing what changed, why, and who did it. None of them can be built on a number with
no history.

M1 therefore does two structural things at once: it introduces the variant as the unit of
inventory, and it makes every quantity change an entry in an append-only ledger. They are done
together because a ledger pointing at products would have to be migrated a second time when
variants arrive.

The work order explains the reasoning behind each decision. Where it states an invariant, treat it
as fixed. Where it states an approach, treat it as a starting proposal.

## What I want from you first

**A design note at `docs/design-notes/m1-variants-ledger.md`. Commit it, then stop.**

Answer the five open questions in §6 of the work order with a recommendation and your reasoning for
each, and propose the schema for variants, options, movements and roles.

I am specifically interested in where you disagree. You can see the whole codebase; I am working
from a reading of it. If you think the enforcement point should be the opposite of what seems
obvious, if the migration strategy in the work order is wrong for this codebase, if there is a
simpler shape for the movement table that satisfies the same invariants — say so, and make the
case. A design note that proposes a better approach and argues it is more valuable than one that
agrees with everything.

What I do not want is silent deviation. Disagree in the note, not in the implementation.

## After the design note is approved

Implement in small, reviewable commits. `pnpm run typecheck`, `pnpm test` and
`pnpm run audit:invariants:strict` must all be green before you call it done — the strict check
means the known direct-stock-write violations recorded in `scripts/audit/baseline.json` are gone,
not merely unchanged.

Your work will be reviewed from the git diff by a separate reviewer who will not see this
conversation. Anything that matters — a decision, a trade-off, a known limitation — has to exist in
a file, not in chat.
