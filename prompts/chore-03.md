# Chore batch 03 — flaky property test, and run-log hygiene

Read `AGENTS.md` and `.agents/rules/testing.md` first. Work on the branch you are on; never commit
to `main`. Two small tasks, **committed separately**. This is deliberately narrow — do not expand it.

---

## Task 1 — the category-tree property test is flaky

`artifacts/store/src/__tests__/storefront-ux.property.test.ts`, the property
`consecutive segments follow parent-child relationship` (around line 368).

It builds a lookup keyed by category slug:

```ts
const slugToNode = new Map<string, CategoryNode>();
...
slugToNode.set(n.slug, n);
```

The generator that produces the tree does not guarantee slugs are unique. When two nodes in
different branches get the same slug, the map keeps only the last one, and the subsequent
parent-child lookup then resolves to a node from a sibling branch — so
`childNode.parent_id === parentNode.id` fails against the wrong node.

The test currently passes most runs and fails occasionally. That is worse than failing: it is in
`store-unit`, the only job gating every push to `main`, and a job that goes red at random teaches
everyone to ignore it. The next phase is a large refactor whose entire safety argument rests on
that job meaning something.

**The bug is in the fixture, not the assertion.** The property itself — that consecutive URL
segments must form a parent-child chain — is correct and must not be weakened. Fix it at the
source: either make the generator produce unique slugs across the whole tree, or key the lookup by
something that is actually unique (node id) while still exercising slug-based navigation.

Pick whichever keeps the property honest and say in your notes which you chose and why. Then **prove
it**: raise `numRuns` temporarily to a few thousand for that property, confirm it is stable, and
report the run count you used. Put it back to the file's normal value before committing.

Do not touch any other test in that file.

---

## Task 2 — stop tracking agent run logs

`.agent-runs/` holds the stdout of headless agent runs. It was committed by accident and will grow
with every phase. Add it to `.gitignore` and `git rm -r --cached .agent-runs` so the directory
survives locally but leaves the index.

Nothing else in `.gitignore` changes.

---

## When you are done

Report the real output of `pnpm run typecheck`, `pnpm run test:unit` and
`pnpm run audit:invariants`. Write `docs/audits/chore-03-notes.md` with what changed, the run count
that proved Task 1 stable, and anything you chose not to do.
