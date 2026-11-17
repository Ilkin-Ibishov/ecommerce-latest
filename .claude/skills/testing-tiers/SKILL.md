---
name: testing-tiers
description: >-
  Use when writing, running or reporting on tests in this repository: which tier runs where
  (unit offline, api-integration and env-validation need Supabase and a running server, E2E
  needs Playwright), what may be claimed as passing locally, and the rule against deleting or
  skipping a test to make a build pass. Was .agents/rules/testing.md, whose glob spanned
  directories and so could never be a scoped AGENTS.md.
---

# Testing rules

## What a test must do
- Fail for one reason. If a test can fail for three unrelated causes, split it.
- Assert behaviour, not implementation. A test that breaks on a rename but not on a wrong result
  is worse than no test.
- Use the existing helpers in `artifacts/api-server/tests/helpers/` rather than writing a parallel
  model of the same behaviour. `stock-model.ts` already simulates decrement semantics — extend it.

## What is not allowed
- Deleting or skipping an existing test to make a suite pass. If it breaks, either the code is
  wrong or the test encoded an assumption that changed — say which, in the design note.
- Loosening an assertion to make it pass. Narrow it or fix the cause.
- Tests that pass because the thing under test was mocked away. If every dependency is a stub,
  the test asserts that stubs work.

## Required coverage for inventory work
- A property or concurrency test asserting the ledger sum equals on-hand quantity after
  interleaved operations, including failures and rollbacks.
- A test that a quantity cannot be changed through any route without producing a movement row.
- A test per RLS policy added: a user of tenant A cannot read or write tenant B's rows.

## Test tiers and commands

Never claim `pnpm test` passed unless you ran it with a live database and running API server. In a fresh clone without Supabase credentials, run the unit tier.

| Command | Tier | Projects included | Environment requirements |
|---|---|---|---|
| `pnpm run test:unit` | Unit | `store-unit`, `env-validation` | None. Runs offline without credentials or servers. |
| `pnpm run test:integration` | Integration | `api-integration` | Supabase credentials (`.env` or `.env.test`) and API server running on port 5000. |
| `pnpm test` | All | All projects above | Full environment: running API server + Supabase database. |

If `SUPABASE_URL` or required credentials are missing, `api-integration` tests fail loudly at setup. Do not fake credentials or skip tests to make `pnpm test` pass.

## Before declaring done
`pnpm run typecheck`, `pnpm run test:unit` (or `pnpm test` if database is configured), and `pnpm run audit:invariants` must all pass.
Report the actual output, not a summary of what you expect it to be. Say plainly which tiers you could not run and why.

## Test taxonomy — use the suffix that states intent

This repo already encodes intent in filenames. Follow it.

| Suffix | Answers | Written when |
|---|---|---|
| `.test.ts` | Does this unit do what it claims? | With the code |
| `.property.test.ts` | Does this invariant hold across generated inputs? | With the design |
| `.integration.test.ts` | Does it hold against real Postgres, HTTP and RLS? | With the migration |
| `.conformance.test.ts` | Do the model and the real system agree? | With the ledger |
| `.exploration.test.ts` | What does the code do *today*? | **Before** changing it |
| `.preservation.test.ts` | Did behaviour that must not change, change? | **Before** the refactor |

## Refactor discipline

A large refactor fails quietly, not loudly. Before changing the order, cart or stock paths:

1. Write `.exploration.test.ts` files capturing what they do now — including behaviour that looks
   wrong. You are recording, not judging.
2. Promote what must survive into `.preservation.test.ts`.
3. Only then refactor. A preservation failure is either a regression or an intended change, and the
   design note must say which **before** the test is touched.

**A preservation test may not be edited in the same commit as the code it guards.** If behaviour
genuinely should change, that is a separate commit with its own justification.

## Conformance testing the ledger

`tests/helpers/stock-model.ts` is a pure in-memory model. Today the property tests assert that the
*model* is correct, which proves nothing about the system — the read-modify-write bug in
`admin/orders.ts` was invisible to all of them.

Use the model as an **oracle** instead: apply the same generated sequence of operations (sales,
receipts, adjustments, cancellations, concurrent pairs) to both the model and the real database
through the real API, and assert they agree, and that the ledger sum equals the stored quantity.

## Concurrency tests must actually be concurrent

A sequential loop passes against a read-modify-write implementation. Use genuinely parallel
requests, or the test asserts nothing about the bug it exists to catch.

## Integration tests must fail, not skip

A test that silently skips because a database URL is missing is a test that does not exist, and the
ones that skip are the RLS tests protecting tenant isolation. If a required database is absent, fail
loudly.

## Integration tests are written without a database — read the schema instead

You cannot run the integration tier, so nothing tells you a setup call is wrong until CI does.
Every round of M4 that added integration tests shipped setup errors. Before each one:

- For every `insert` in setup, open the table's `CREATE TABLE` (and any later `ALTER`) and supply
  every `NOT NULL` column without a default, and a value each `CHECK` and `UNIQUE` accepts.
- For every enum or status literal in a filter or an insert, find the literal in the migration that
  defines it. A value that does not exist is a `22P02` at run time, not a type error.
- Assert `error` is null on **every** setup call, so a broken fixture fails where it breaks.
- When a test looks a row up in a function's result, check the function's own `WHERE` clause first:
  a row the function rightly filters out is a test-data error, not a defect.

## A validation schema must match the thing it validates

A Zod schema for a database function's result takes its keys from that function's `RETURNS TABLE`,
same names, nothing invented, and `numeric` columns are never `.int()`. Prove it offline with a
test that reads the migration and the route as text and compares the two key lists (see
`invariant-*.test.ts`). M4 shipped schemas with five field names no function returned; every route
answered 500 and only CI saw it.
