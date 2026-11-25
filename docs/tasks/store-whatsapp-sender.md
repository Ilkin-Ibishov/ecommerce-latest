# The shop's own WhatsApp number, set from the admin screen

Status: deferred — backlog (owner request, 2026-11-25). Starts after the auth-hardening slice S1; owner decisions in §9 first.

Spec, 2026-11-25. Written by the architect.

## 1. Why this exists

WhatsApp messages (sign-in codes, order confirmations, status updates) go out through UltraMsg with
an instance ID and token read from Railway environment variables. So:

- Every new shop needs a developer to set two variables and redeploy before it can send anything.
  That is a manual step in onboarding a second tenant, and onboarding is what the roadmap wants
  automated.
- Messages come from whichever number the developer paired, not from the shop's own number, so
  customers see a number they do not know.
- The sender texts hard-code another shop's identity: `lib/whatsapp.ts` falls back to
  `"ILK Electronics"` and a personal phone number (`ADMIN_PHONE`).

The owner should be able to connect his own WhatsApp number from inside the product, test it, and
replace it, without a developer.

## 2. Scope

One settings section (`/admin/settings` → WhatsApp), three routes, one table. The owner enters his
UltraMsg instance ID and token, sees whether the connection works, sends a test message to himself,
and can disconnect. Every outgoing WhatsApp message then uses those credentials.

Tenancy note: the product runs one database per shop. "Per shop" here means one row in that shop's
own database. There is no `tenant_id`, exactly like every other table.

## 3. The invariant that defines this phase

> **A messaging secret is written by the owner, readable only by the server, and never leaves the
> server again — not to the browser, not to a log, not to the audit trail.**

## 4. Decisions already taken — do not re-litigate; flag if you believe one is wrong

- **Not in `store_settings`.** That table has a public-read policy. Secrets go in a new table,
  `messaging_credentials`, with RLS enabled, **no client policies**, and
  `REVOKE ALL … FROM anon, authenticated`. Only the service role reads or writes it.
- **One row per provider**, `provider text primary key check (provider in ('ultramsg'))`. Columns:
  `instance_id text not null`, `token_ciphertext bytea not null`, `token_iv bytea not null`,
  `token_tag bytea not null`, `key_version int not null`, `token_last4 text not null`,
  `sender_phone text`, `status text not null check (status in ('connected','error'))`,
  `last_checked_at timestamptz`, `updated_by uuid references public.users(id)`,
  `updated_at timestamptz not null default now()`. The `check` is widened when another provider
  arrives.
- **Encryption in the application:** AES-256-GCM, Node `crypto`, key from env
  `MESSAGING_CREDENTIALS_KEY` (32 random bytes, base64), random 12-byte IV per write. `key_version`
  exists so the key can be rotated later; this phase only writes version 1. Why not Supabase Vault:
  it ties the secret to one Postgres feature and makes local and CI databases harder to set up; the
  application key is one env var. If you see a better trade-off, say so in the design note.
- **Admin only.** All three routes are `requireAdmin`. Staff get 403. The settings section is hidden
  from staff in the sidebar, but the route check is what counts.
- **The token is write-only.** `GET` returns `instance_id`, `token_last4`, `sender_phone`, `status`,
  `last_checked_at`, `updated_at`. Never the token, never the ciphertext.
- **Validate before saving.** On `PUT`, call UltraMsg with the submitted pair to confirm the instance
  is authenticated (find the instance-status endpoint in https://docs.ultramsg.com and name it in the
  design note). Save only on success; otherwise 422 `{ error: "whatsapp_credentials_invalid" }` and
  nothing is stored.
- **Resolution order when sending:** row in `messaging_credentials` → environment variables (legacy,
  kept for one release so existing deployments keep working) → none. With none in production:
  `/auth/otp/request` returns 503 `messaging_unavailable` (the S1 rule), order notifications are
  recorded as failed. Never a mock send, never a logged body.
- **Read the credentials on each send**, decrypting in memory. No cache. This product sends tens of
  messages a day (AGENTS.md: prefer the simple query).
- **Store name and contact phone in message texts** come from `site_settings` (`store_name`,
  `contact.phone`). Remove the `"ILK Electronics"` and `ADMIN_PHONE` fallbacks.
- **Audit:** set, replace and remove each write an audit-log line with the actor and the action.
  The payload contains `instance_id` and `token_last4` only.

## 5. Routes

| Route | Does |
|---|---|
| `GET /admin/settings/whatsapp` | Masked state as in §4, or `{ configured: false }` |
| `PUT /admin/settings/whatsapp` | Body `{ instance_id, token, sender_phone? }`, zod-validated (instance id pattern, token length bounds). Validates with UltraMsg, encrypts, upserts, audits |
| `DELETE /admin/settings/whatsapp` | Removes the row, audits |
| `POST /admin/settings/whatsapp/test` | Sends a fixed test text to **the caller's own verified phone** — no phone in the body |

The existing `GET /admin/whatsapp/status` and `POST /admin/whatsapp/test` (`routes/admin/whatsapp.ts`)
are replaced by these. The old test route accepts any phone in the body, which makes it a way to
send arbitrary WhatsApp messages from the shop's number; it goes away.

## 6. Screen

A section in the existing settings page, following the existing tab pattern
(`pages/admin/settings/`): status badge (Qoşulub / Xəta / Qoşulmayıb), instance ID, token field that
shows `••••last4` when set and is empty on edit, sender phone, buttons Save, Send test message,
Disconnect (with `useConfirm()`, not native `confirm()`). Short help text linking to UltraMsg's
dashboard for creating an instance and scanning the QR code. All strings in the three dictionaries.

## 7. Where it lives in the code

Uses `lib/messaging/` from `docs/tasks/telegram-staff-otp.md` (whichever ships first creates it).
`whatsapp-ultramsg.ts` gains a credentials resolver (`resolveUltraMsgCredentials()`) and does not
read `process.env` anywhere else. New `lib/messaging/credentials-crypto.ts` (encrypt/decrypt,
unit-tested, under 100 lines). The startup assertion from S1 requires `MESSAGING_CREDENTIALS_KEY` in
production.

## 8. Tests

Unit: encrypt→decrypt round trip; tampered ciphertext or tag fails to decrypt; wrong key fails;
resolver order (row beats env; env used when no row; none in production → `messaging_unavailable`);
no log line or audit payload contains the token.
Integration: staff token → 403 on all four routes; customer → 403; `PUT` with credentials UltraMsg
rejects (mocked) stores nothing; `GET` after `PUT` never contains the token; PostgREST with anon and
authenticated keys cannot select from `messaging_credentials`; the test route sends only to the
caller's phone and ignores a `phone` in the body.

## 9. Owner decisions needed before launch

1. **Whose UltraMsg account?** Recommendation: each shop owner opens and pays for his own UltraMsg
   instance, so the number, the bill and the ban risk are his. The alternative (the platform pays and
   resells) makes you responsible for every shop's WhatsApp number.
2. **A dedicated number, not the owner's personal one.** UltraMsg drives WhatsApp Web; it is not
   Meta's official API, and WhatsApp can ban numbers that send automated messages. The help text will
   say "use a separate business number". Confirm you want that wording shown to owners.

## 10. Not in this phase

| Not built | Re-open when |
|---|---|
| QR pairing inside our admin screen (UltraMsg QR endpoint) | Owners find the UltraMsg dashboard step too hard |
| WhatsApp Cloud API (Meta, official) as a second provider | A shop's number is banned, or volume/compliance needs it — the `OtpSender` interface makes it one new file |
| Several sender numbers per shop | A shop with branches asks |
| Editable message templates | Owners ask to change the wording |
| Inbound messages / UltraMsg webhooks | Customer replies need handling in the product |
| Key rotation tooling for `MESSAGING_CREDENTIALS_KEY` | Before the second shop goes live, or on suspected key exposure |

## 11. Definition of done

`pnpm run typecheck`, `pnpm test:unit`, `pnpm run audit:invariants` pass. Migration applied to the
test project with the owner's yes. Integration and E2E green in CI. The owner connects a number on
the test project and receives the test message; recorded in
`docs/audits/store-whatsapp-sender-notes.md` with the tiers that ran. The Railway
`ULTRAMSG_*` variables can then be removed in a follow-up release.

## 12. What is not verified

UltraMsg's instance-status endpoint name and response shape were not checked against its docs. The
WhatsApp ban rate for UltraMsg numbers is not known; the risk is stated, not measured.
