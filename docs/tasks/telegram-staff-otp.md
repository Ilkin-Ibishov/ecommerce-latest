# Staff and owner sign-in codes through Telegram

Status: deferred — backlog (owner request, 2026-11-25). Starts after the auth-hardening slice S1; owner decisions in §9 first.

Spec, 2026-11-25. Written by the architect.

## 1. Why this exists

Every sign-in code today goes through one channel: WhatsApp via UltraMsg. That is one unofficial
provider, one paired phone, and one account whose message log contains every code it ever sent.
The owner's and staff codes are the most valuable ones in the system: whoever reads them holds the
admin screen, the till and the stock. Moving them to a second, independent channel does two things:

- **Availability.** If the WhatsApp number is banned, unpaired or out of credit, the shop can still
  sign in and sell.
- **Blast radius.** A compromise of the WhatsApp provider no longer yields an admin session.

Customers keep WhatsApp. Nothing changes for them.

## 2. Scope

The server chooses the delivery channel for an OTP from the role of the account that owns the
phone. `staff` and `admin` receive the code through Telegram; everyone else through WhatsApp as
today. One login modal, one verify route, one code store. No new sign-in method.

## 3. The invariant that defines this phase

> **The channel is decided by the server from `public.users.role`, never by the client. A code for
> a staff or admin account is never sent through WhatsApp unless the owner has switched the
> break-glass fallback on.**

If the client could choose the channel, an attacker who controls one channel would simply pick it.

## 4. Decisions already taken — do not re-litigate; flag if you believe one is wrong

- **Provider: Telegram Gateway API** (`https://gatewayapi.telegram.org/`), method
  `sendVerificationMessage`. It delivers a code to a phone number in E.164 form, to that number's
  Telegram account, with no bot and no linking step. Price is about $0.01 per delivered code; a
  message not delivered within `ttl` is refunded.
- **We generate the code, Telegram only delivers it.** Pass our code in the `code` parameter
  (numeric, 4–8 chars; ours is 6). Do **not** use `checkVerificationStatus` for verification. The
  code store, attempt counter, lockout and verify RPC from S1 stay the single source of truth for
  both channels.
- Send with `ttl = 600` (our code lifetime) so undelivered codes are refunded.
- **The token is the platform's, not the shop's.** One Gateway account serves every store instance
  (the product is one Supabase project + one API per store; see
  `docs/archive/planning/feature-roadmap.md` item 26). Env var
  `TELEGRAM_GATEWAY_TOKEN`, server only, never in a `VITE_` variable.
- **Explicit switch, no implicit behaviour:** `STAFF_OTP_CHANNEL=telegram|whatsapp`, default
  `whatsapp`. With `telegram` and no token, the server refuses to start (same startup assertion as
  S1). Absence of a token never silently changes the channel.
- **No silent fallback.** If Telegram cannot deliver (number not on Telegram, API error, timeout of
  10 s), the request fails with `{ error: "telegram_unavailable" }` and the UI tells the person to
  open Telegram on that number or ask the owner. It does **not** retry through WhatsApp.
- **Break-glass:** `STAFF_OTP_WHATSAPP_FALLBACK=1` (env, set by the owner on Railway) allows the
  fallback while set. Every fallback send writes a security event. This exists so the owner cannot
  lock himself out; it is not a normal mode.
- **Role is revealed by the channel, accepted.** The response for a staff/admin phone says
  `channel: "telegram"` so the modal can say where to look. That tells a caller the number belongs
  to staff. Accepted: the owner's number is public already, staff numbers are low-value, and the
  alternative (a hint that does not say where the code went) costs real support time. Rate limits
  from S1 bound enumeration.
- **Rate limits, lockout and security events from S1 apply unchanged** to both channels, keyed by
  phone, not by channel.

## 5. Where it lives in the code

- New `artifacts/api-server/src/lib/messaging/`:
  - `types.ts` — `interface OtpSender { send(phone: string, code: string): Promise<SendResult> }`,
    `SendResult = { ok: true; providerRequestId?: string } | { ok: false; reason: "not_reachable" | "provider_error" | "timeout" }`.
  - `whatsapp-ultramsg.ts` — wraps the existing UltraMsg send (move, do not duplicate, the logic in
    `lib/whatsapp.ts`).
  - `telegram-gateway.ts` — the new sender. Bearer token header; `phone_number`, `code`, `ttl`,
    `payload` (our `otp_requests.id`, for traceability). Map the response: `ok: false` with an error
    meaning the number cannot receive → `not_reachable`; anything else → `provider_error`. Look up
    the real error strings in the Gateway docs and list them in the design note; do not guess.
  - `route-otp.ts` — `chooseOtpChannel(role)` → `"telegram" | "whatsapp"`, a pure function, unit
    tested.
- `routes/auth.ts` `/auth/otp/request`: normalise phone → look up `users.role` for that phone (a
  phone with no account is `customer`) → choose channel → create OTP → send → respond
  `{ success: true, channel }`. On `telegram_unavailable` respond 422 with that error code.
- `otp_requests` gets `delivery_channel text not null default 'whatsapp'` and
  `provider_request_id text`. One migration, one concern.
- `LoginModal.tsx`: after request, show "Kod Telegram-a göndərildi" / "Код отправлен в Telegram" /
  "Code sent to Telegram" when `channel === "telegram"`, the WhatsApp text otherwise, and a clear
  message for `telegram_unavailable`. All three dictionaries; no hard-coded strings.
- **Shared with `docs/tasks/store-whatsapp-sender.md`:** whichever phase ships first creates
  `lib/messaging/`; the second one extends it. Neither duplicates the UltraMsg call.

## 6. Owner and staff experience

- The owner adds staff by phone as today (`/admin/users`). Under the phone field, a one-line note:
  "Bu nömrə Telegram-da olmalıdır — giriş kodu ora gələcək." No API call at that moment
  (`checkSendAbility` costs a fee and adds little).
- First sign-in: code arrives in Telegram's verification chat. If the number is not on Telegram, the
  modal says so; the owner either installs Telegram on that number or turns on break-glass.

## 7. Tests

Unit (mocked `fetch`): `chooseOtpChannel` for all three roles and for an unknown phone; staff phone
→ Telegram called, UltraMsg not called; customer → UltraMsg only; Telegram `not_reachable` → 422
`telegram_unavailable`, UltraMsg **not** called; same with `STAFF_OTP_WHATSAPP_FALLBACK=1` → UltraMsg
called and a security event logged; a request body containing `channel` has no effect;
`STAFF_OTP_CHANNEL=telegram` without token → startup assertion fails; the code passed to Telegram
equals the one hashed into `otp_requests`; no log line contains the code.
Integration: a staff phone's `otp_requests` row has `delivery_channel = 'telegram'`. Use the Gateway
test environment (free) — never a real paid send in CI.

## 8. Not in this phase

| Not built | Re-open when |
|---|---|
| Telegram for customers | WhatsApp delivery or cost becomes a problem for shoppers |
| A Telegram bot (chat_id linking, `/start` + shared contact) | Gateway payment is impractical (§9 Q1), or the shop wants order alerts in Telegram |
| Delivery reports via `callback_url` | Owners report codes "not arriving" and we need evidence |
| `sender_username` (codes signed by the shop's verified channel) | A shop has a verified Telegram channel |
| Revoking the Telegram message after a successful sign-in | Codes visible in chat history become a concern |
| Order and stock notifications through Telegram | Separate spec |

## 9. Owner decisions needed before launch

1. **Paying Telegram.** The Gateway account is funded through Telegram's own payment platform
   (Fragment / TON at the time of writing). Is that workable for you? If not, the fallback design is
   a Telegram bot, which is free but needs every staff member to press Start once and share their
   contact; it would be a different spec.
2. **Does every staff member have Telegram on the same number they sign in with?** If not, which
   ones, and should they keep WhatsApp (that would need a per-user channel field — a scope change).

## 10. Definition of done

`pnpm run typecheck`, `pnpm test:unit`, `pnpm run audit:invariants` pass. The migration applied to
the test project with the owner's yes. Integration and E2E green in CI. A real sign-in by the owner
through Telegram on the test project, recorded in `docs/audits/telegram-staff-otp-notes.md` with the
tiers that ran.

## 11. What is not verified

The exact Gateway error strings for "number not on Telegram" (the API reference lists only
`ACCESS_TOKEN_INVALID` explicitly). Current price and funding method — checked against
core.telegram.org on 2026-11-25; recheck before launch. Whether Gateway delivery to Azerbaijani
numbers has any regional restriction.
