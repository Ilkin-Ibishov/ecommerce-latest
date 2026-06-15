# Tenancy Model Decision: Shared-Schema Retrofit vs. Deployment-per-Tenant Control Plane

> Decision record for the Super Admin Platform. This is the one fork that drives migration risk, isolation strategy, cost, and time-to-revenue. Pick deliberately before generating tasks. Status: **PROPOSED — awaiting owner decision.**

## Context

Today the product runs as **one store per deployment**: a single Supabase project + one Vercel deployment per live store, with no `tenant_id` anywhere and `users.role` limited to `('customer','admin')`. The goal is to lease ready-made stores to many owners and operate them from one Super Admin control plane (intel, suspend non-payers, notifications, billing).

Two fundamentally different ways to get there.

---

## Option A — Shared-schema multi-tenancy (one DB, `tenant_id` everywhere)

Retrofit `tenant_id` onto ~20 existing tables in a single shared Supabase database; resolve tenant by host; enforce isolation in the app layer (`tenantScope()`) with RLS as a backstop. (This is what the current design.md assumes.)

**Pros**
- Highest tenant *density* / lowest per-tenant infra cost — many stores share one DB and one deployment.
- One codebase, one schema, one deploy pipeline to operate.
- Cross-tenant analytics (MRR, totals) are a trivial query over one DB.
- Central control plane talks to one database.

**Cons**
- **Highest blast radius.** A single forgotten `.eq('tenant_id')` on the service-role client = cross-tenant data breach. Isolation rests on developer discipline, not physical separation.
- **Riskiest migration.** Adding `tenant_id` + converting global unique constraints (`sku`, `coupon code`, slugs, single-row `site_settings`) on a **live** store with continuous `main`→Vercel deploys.
- RLS does **not** protect the main path (service-role bypasses it), so the real control is app-layer scoping — the fragile spot.
- **Noisy neighbor**: one tenant's catalog size / traffic spike degrades all others; quotas cap counts, not load.
- Per-tenant backup/restore and data-subject deletes are harder in a shared DB.

**When it wins:** many low-value tenants, density economics matter, you have engineering bandwidth to enforce isolation rigorously (restricted DB role + RLS that binds on it, static lint forbidding un-scoped queries, isolation integration tests as the first tests written).

---

## Option B — Deployment/database per tenant + thin control plane

Keep each store physically isolated (its own Supabase project or at least its own schema/DB + its own Vercel deployment, provisioned from the existing single-tenant codebase). The Super Admin becomes a **control plane that orchestrates N isolated instances**: a small platform registry DB holds the tenant roster, subscription/billing, and a pointer to each store's instance; the control plane aggregates intel by calling each instance, flips a suspension flag per instance, and fans out notifications.

**Pros**
- **Isolation is physical** — near-zero cross-tenant breach risk. The product's core promise ("your store, your data") is structurally guaranteed, not test-enforced.
- **Matches how the product already runs** — no risky retrofit of the live store; the existing single-tenant code is the per-tenant artifact, largely untouched.
- **No noisy neighbor**; per-tenant scaling, backup, and deletion are trivial (drop the instance).
- Fastest path to your *stated* asks (roster view, suspend, notify) without re-architecting data.
- A tenant's bug/migration can't take down others.

**Cons**
- **Lower density / higher per-tenant cost** — each store is its own project/deployment (Supabase project limits, Vercel project sprawl, cost per tenant). Matters at hundreds of tenants, less so at tens.
- **Provisioning automation becomes the hard part** — spinning up a new isolated instance (DB, env, deploy, domain, seed) must be scripted and reliable.
- **Cross-tenant analytics require fan-out/aggregation** (call each instance or roll up to the registry) instead of one query.
- More moving parts to operate (N deployments), needs good automation/observability.

**When it wins:** small number of high-value tenants, isolation is the selling point, you want to start leasing *soon* with minimal risk to the live store, and you can later migrate hot/low-value tenants into a shared pool if density demands it.

---

## Recommendation

For your situation — **a leasing business starting from a single live store, a likely-modest initial tenant count, and isolation as the product promise** — start with **Option B (deployment/database per tenant + thin control plane)**, with a deliberate option to introduce a shared pool later for low-value/high-density tenants (a hybrid most mature platforms converge on anyway).

Rationale:
1. It removes the single largest risk in the current plan (the live shared-DB retrofit) entirely.
2. It delivers your three actual asks — cross-tenant intel, suspend non-payers, notifications — fastest, because no data re-architecture blocks them.
3. Isolation is structural, so you don't bet customer-data safety on never forgetting a `WHERE tenant_id =` clause.
4. The economics only turn against you at scale, and by then you'll have revenue to fund a measured shared-schema migration for the tenants where density actually pays.

The cost to accept: invest early in **provisioning automation** (the thing that makes "fast, easy to own" real anyway) and in a **registry + aggregation layer** for cross-tenant reporting.

If you expect hundreds of small/free tenants quickly, or per-tenant infra cost is the binding constraint, Option A becomes the right call — but only with database-enforced isolation (dedicated restricted Postgres role + RLS that binds on it, not service-role-everywhere) and a static check forbidding un-scoped tenant-table access.

## Impact of the choice on the existing spec

| Area | If Option A (shared schema) | If Option B (per-tenant) |
|---|---|---|
| Requirements 1–19 | Mostly unchanged | Mostly unchanged in *intent*; isolation reqs (R9) satisfied structurally |
| design.md multi-tenancy section | Keep, but harden isolation (restricted role + RLS-on-role + lint) | Replace with a control-plane + registry + provisioning + per-instance suspension model |
| Highest-risk task | Live `tenant_id` migration | Provisioning automation + registry aggregation |
| Billing/notifications/analytics | One DB | Registry DB + fan-out |

## Decision needed

Which model do we commit to? Once chosen, the next step is to **restructure the design into the phased roadmap** (Foundation → core asks: intel/suspend/notify → monetization → polish) aligned to that model.
