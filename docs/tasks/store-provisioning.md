# One command creates a new store

Status: deferred — backlog (owner request, 2026-11-25). Hard prerequisite: the reproducible-database work (auth-hardening slice S3). Owner decisions in §10 first.

Spec, 2026-11-25. Written by the architect.

## 1. Why this exists

The product runs one isolated stack per store: its own Supabase project, its own API on Railway, its
own storefront on Vercel, registered in the control plane (`docs/archive/planning/feature-roadmap.md`
item 26 keeps it that way until about 8–10 stores). Today there is no script for any of it.
Creating store number two means, by hand: create a Supabase project; build its database from SQL the
repository cannot reproduce on its own; seed settings that still name the first shop
(`20260606110418_create_store_settings.sql` seeds ILK Electronics' phone and e-mail; `supabase/seed.sql`
seeds 18 electronics brands); set about twenty environment variables across two hosts; create the first
admin through `/bootstrap/admin`; and insert a control-plane `stores` row by hand, because no route
creates one.

Each manual step is a place to make a security mistake (a missing variable that fails open, a
forgotten Supabase sign-up toggle, a reused secret). It also costs the owner a day per customer. The
roadmap already names this as the higher-leverage work before shared multi-tenancy:
"automate the current isolated onboarding".

## 2. Scope

A CLI, `pnpm provision:store`, run by the platform owner from his own machine. It creates one complete,
hardened, registered store from a few inputs, is safe to re-run after a failure, and prints a report.
It does not build shared multi-tenancy and does not add a self-service sign-up for shop owners.

## 3. The invariants that define this phase

> **A store comes out of provisioning already in its secure state. Nothing is "set up later by hand".**

> **Provider tokens (Supabase, Railway, Vercel, control plane) live only on the machine running the CLI.
> A store instance never holds a credential that reaches another store or the control plane.**

The second matters because today `routes/index.ts` mounts the platform router in every API process.
Any store API given `CONTROL_PLANE_SUPABASE_SERVICE_KEY` would be a full control plane; one compromised
shop would expose every shop.

## 4. Decisions already taken — do not re-litigate; flag if you believe one is wrong

- **CLI first, not an endpoint.** `scripts/provision/` (TypeScript, run with `tsx`), invoked as
  `pnpm provision:store`. A `/platform/stores/provision` endpoint is a later phase; the CLI's steps are
  written as functions so that endpoint can call them.
- **Inputs:** `--name`, `--slug` (a-z, 0-9, hyphen; becomes the project and service names),
  `--owner-phone`, `--owner-name`, `--locale az|ru|en`, `--region`, optional `--domain`, `--dry-run`.
- **Provider credentials from the CLI's environment only:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID`,
  `RAILWAY_TOKEN`, `VERCEL_TOKEN`, `CONTROL_PLANE_SUPABASE_URL`, `CONTROL_PLANE_SUPABASE_SERVICE_KEY`.
  Read from a local `.env.provision` that `.gitignore` covers (add the entry). Never written to a store.
- **APIs, not clicks:** Supabase Management API (create project, poll until healthy, read keys, set auth
  config, read/set network and SSL settings); Railway's public API or CLI (service from this repo,
  variables, domain); Vercel REST API (project, env vars, domain). Name the exact endpoints in the design
  note from each provider's current docs; do not guess them.
- **Store vs control plane, by configuration:** add `APP_ROLE=store|control-plane` to the API. With
  `store`, the platform router is not mounted, and the process refuses to start if any
  `CONTROL_PLANE_SUPABASE_*` variable is set. With `control-plane`, the store routes are not mounted.
  Provisioning always sets `APP_ROLE=store`. The control plane is its own deployment.
- **Every secret is generated fresh per store** with `crypto.randomBytes(32)`: `SESSION_SECRET`,
  `OTP_PEPPER`, `AUTH_PASSWORD_PEPPER`, `MESSAGING_CREDENTIALS_KEY`, `STORE_PLATFORM_SECRET`, the
  database password. Secrets are sent straight into the provider's variable store and never printed,
  logged or written to disk. The report shows only that each one is set.
- **The first admin is created directly** with the new project's service role (the same rules as
  `/bootstrap/admin`: normalised Azerbaijani phone, never a test phone). `BOOTSTRAP_SECRET` is never set
  on a provisioned store.
- **Database:** apply the baseline and migration chain from S3, by the same replay command CI uses.
  If S3 has not shipped, the CLI refuses to run. There is no fallback to `schema.sql`.
- **Seed is industry-neutral and empty of another shop's data:** one `site_settings` row with the store
  name and locale; `store_settings` with neutral defaults and the owner's contact phone; no brands, no
  banners, no products. Move the electronics brand list and the ILK contact values out of the default
  path (a demo seed may keep them, clearly named).
- **Security baseline is applied, then verified, by the CLI:** Supabase sign-ups off, phone provider
  off, SSL enforced; `NODE_ENV=production`, `APP_ROLE=store`, `ALLOWED_ORIGINS` = the store's domains;
  no `E2E_*`, `OTP_TEST_BYPASS` or `BOOTSTRAP_SECRET`. These come from the auth-hardening spec's owner
  actions (O3, O4); here they stop being manual.
- **Control-plane registration** inserts the `stores` row with `platform_status = 'onboarding'`,
  `instance_url`, `metrics_endpoint_url`, and the store credential **hashed** (SHA-256), not the
  plaintext the column holds today. Fixing the comparison in `store-feed.ts`/`metrics.ts` to hash the
  presented bearer is part of this phase (it is finding F-22 of the audit).
- **Resumable, not transactional.** After each step, write its result (ids, URLs; never secrets) to the
  control plane, in a new table `store_provisioning_steps (store_slug, step, status, detail jsonb,
  updated_at)` with RLS on and no client policies. Re-running with the same `--slug` skips completed steps.
  A secret that would have to be re-generated on resume (because it was never stored) is re-generated
  and re-set everywhere it is used, in the same step.
- **No automatic teardown in this phase.** A failed run leaves the store at `onboarding` with its step log;
  the report lists exactly what exists and where. Deleting a provider project is a manual, deliberate act.
- **`--dry-run`** validates inputs and provider tokens, checks the slug and domain are free, prints the
  plan, and creates nothing.

## 5. The steps, in order

1. Validate inputs and tokens; refuse if the slug exists in `stores` with a status other than `onboarding`.
2. Create the Supabase project; wait until healthy (timeout 10 min); read URL, anon and service keys.
3. Apply the S3 migration chain; run the S3 anon-grant probe against the new database and stop on any failure.
4. Seed (§4) and create the first admin.
5. Supabase auth and network settings (§4), then read them back and compare.
6. Railway service from this repository, variables (§6), deploy, wait for `/api/health`.
7. Vercel project, variables, deploy, optional domain; wait for the storefront to answer.
8. Control-plane `stores` row; `platform_status` stays `onboarding` until the owner activates it.
9. Smoke test (§7). Only if it passes does the report say "ready".

## 6. Variables a store receives

The design note lists every variable the code reads (`grep process.env` / `import.meta.env`) and marks each
one as: set by provisioning, deliberately unset, or control-plane only. At minimum: `NODE_ENV`, `APP_ROLE`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `OTP_PEPPER`,
`AUTH_PASSWORD_PEPPER`, `MESSAGING_CREDENTIALS_KEY`, `STORE_ID`, `STORE_PLATFORM_SECRET`,
`PLATFORM_STATUS_URL`, `PLATFORM_QUOTA_URL`, `PLATFORM_CONTROL_PLANE_URL`, `ALLOWED_ORIGINS`; storefront
`VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STORE_NAME`. Deliberately unset on a
store: every `CONTROL_PLANE_SUPABASE_*`, `VITE_CONTROL_PLANE_*`, `BOOTSTRAP_SECRET`, `E2E_*`,
`OTP_TEST_BYPASS`, `ULTRAMSG_*` (the owner connects WhatsApp in the product once
`docs/tasks/store-whatsapp-sender.md` ships; until then the CLI accepts them as optional inputs).
If a variable the code reads is not on either list, the CLI fails — that list is the contract.

## 7. Smoke test

`GET /api/health` is 200; the storefront returns the store's name; an anon PostgREST call to a SECURITY
DEFINER function returns `42501`; `POST /auth/otp/request` for a test phone returns 4xx (no bypass in
production); the platform router answers 404 on the store API; Supabase reports sign-ups disabled; the
control plane can read the store's metrics endpoint with the hashed credential.

## 8. Tests

Unit (providers mocked): input validation; the plan for a fresh slug; resume skips completed steps;
secrets never appear in the report, the step log or any log line (assert on captured output); a variable
read by the code but missing from §6's lists fails the CLI; `APP_ROLE=store` with a control-plane key set
refuses to start; the platform router is not mounted with `APP_ROLE=store`.
Integration: one real end-to-end run against a throwaway Supabase project in a sandbox org, recorded in
the notes, then deleted by hand. Never in CI on every push (it creates billable resources).

## 9. Not in this phase

| Not built | Re-open when |
|---|---|
| `/platform/stores/provision` endpoint and a "new store" button in the platform console | The CLI has created two real stores without manual fixes |
| Self-service sign-up for shop owners | There is a price, a contract, and more than a handful of customers |
| Automatic teardown / `deprovision` | Offboarding is needed (control-plane `store_offboarding` exists for the data side) |
| One shared storefront deployment for all stores (runtime config by hostname instead of build-time `VITE_*`) | Vercel cost or deploy time per store becomes a problem — it would cut one deployment per store |
| Shared multi-tenancy (`store_id` columns) | Roadmap item 26: about 8–10 stores |
| Custom domain purchase and DNS automation | Owners stop bringing their own domain |

## 10. Owner decisions needed before launch

1. **Supabase plan and org.** Each store is a Supabase project; on Pro the plan fee is per organization and
   compute is billed per project (about $10/month for the smallest size, the first one covered by the
   plan's credit). Confirm one organization for all stores, on Pro.
2. **Region.** The current test project is in `ap-south-1` (Mumbai). For shops in Azerbaijan an EU region
   (e.g. Frankfurt) is likely closer. Pick one default.
3. **Who owns the accounts.** Recommendation: the platform (you) owns Supabase, Railway and Vercel for
   every store and charges a monthly fee that covers them; the shop owner owns only his domain and his
   WhatsApp number. Confirm, because it decides what the monthly price must cover.
4. **Hosting plans.** Check that the Railway and Vercel plans you use allow commercial use and several
   projects; their current terms were not verified for this spec.

## 11. Definition of done

`pnpm run typecheck`, `pnpm test:unit`, `pnpm run audit:invariants` pass. One real provisioning run
creates a store that passes §7 with no manual step, recorded in `docs/audits/store-provisioning-notes.md`
with the command output (secrets redacted by construction, not by hand). A second run with the same slug
changes nothing. A run interrupted after step 3 completes on re-run.

## 12. What is not verified

The exact Supabase Management, Railway and Vercel API endpoints and their rate limits. Whether Supabase's
auth settings for sign-ups and the phone provider are all settable through the Management API (if one is
not, the CLI must stop and print the single manual step, not skip it silently). Current Railway and
Vercel pricing and terms. Whether the platform console pages in the storefront bundle need
`VITE_CONTROL_PLANE_*` at build time; if they do, store builds must exclude those pages.
