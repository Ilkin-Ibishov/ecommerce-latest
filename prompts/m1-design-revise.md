# M1 — revise the design note

Your design note was reviewed. The verdict is **FIX, not redesign**: the architecture is right and
the two places where you disagreed with the spec were both correct and better reasoned than the
spec. Keep the shape.

Read `docs/audits/m1-design-note-review.md`. It lists three blockers, one major and three minor
items, each with the reasoning. Resolve them in `docs/design-notes/m1-variants-ledger.md` and commit
the revised note.

**Do not start the migration yet.** B1 and B3 change the schema and B2 changes the trigger contract,
so implementing before the revision is reviewed means writing them twice.

Two of these deserve a real decision rather than a mechanical edit:

**B1 (cost_price is world-readable)** — the review proposes two options and leans toward a separate
`variant_costs` table. Choose, and justify. If you see a third approach that keeps cost out of
public catalog reads without splitting the table, propose it; the requirement is that RLS, not
Express, is what stops an anonymous caller reading margin.

**B2 (the Insufficient stock error)** — you need a recognisable, catchable error from inside the
trigger that the RPC wrapper can map to today's API response. Say what SQLSTATE you will use and how
the wrapper distinguishes it, so the existing tests keep their meaning.

For M1 (the false `FOR UPDATE` claim), simply correct the note to describe what the statement really
does and why a bare `UPDATE ... SET x = x + delta` is already safe under concurrency. That sentence
matters more than it looks: it is what stops the next reader from "fixing" it into a race.

If you think any finding is wrong, say so in the note with your reasoning rather than complying.
A disagreement you can defend is more useful than a change you do not believe in.
