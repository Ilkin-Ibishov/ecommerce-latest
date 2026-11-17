---
name: locale-key-add
description: >-
  Use when adding, renaming or removing a UI string in artifacts/store — a t() key, a labelKey,
  any user-visible label — and when an E2E assertion names a literal that a change is about to
  turn into a t() call. This project shipped the same class of bug twice.
---

# Adding a locale key

Three dictionaries, one schema, and one trap about which locale a test actually runs in.

## The keys

`artifacts/store/src/lib/i18n/messages/` holds `az.ts`, `en.ts` and `ru.ts`.

- **`az.ts` is the schema.** `schema.ts` derives `MessageSchema` from it, so a key that is not in
  az does not exist as far as types are concerned.
- `en.ts` and `ru.ts` are declared `const x: MessageSchema`, so a key present in az and missing
  from either is a **typecheck error**. Add to all three in the same commit.
- A key used in source but absent from az is caught by the `i18n-keys-exist-in-dictionaries`
  invariant: `pnpm run audit:invariants`. It reads every dotted `t("...")` and `labelKey: "..."`
  literal under `artifacts/store/src`.
- No plain text in the UI. Every label, button, placeholder and heading goes through `t()`.

A dynamic key built by interpolation is invisible to both guards. Prefer a lookup object of
literal keys so the invariant can see them.

## The stale-locale trap

**When a change replaces a hardcoded literal with a `t()` call, every E2E assertion on that
literal must move to the locale the spec actually runs in.**

The till's strings were hardcoded Azerbaijani and `counter-sale.spec.ts` asserted them directly.
A round correctly replaced them with `t()` calls and added the dictionary block — which turned six
assertions into strings that can never match, because **the admin UI runs in English in that
spec** (its `loginAsAdmin` waits for "Dashboard" and "Sign In with Phone"). CI failed on
`getByRole("heading", { name: "Kassa" })`.

So, before changing a literal to `t()`:

```bash
grep -rn "<the literal>" artifacts/store/tests artifacts/store/src
```

Then check which locale the spec drives — read its login helper, do not assume — and move the
assertion to that locale's value. Never delete or weaken the assertion.

Two further lessons from the same incident:

- **Verify the premise of an audit finding, not only the finding.** A later audit cleared those
  selectors carefully — against the **az** dictionary, which is not what the page renders.
- **A repeated test name does not mean a repeated cause.** The same test was called flaky on
  another branch, which carried the *untranslated* till and failed on timing. Two unrelated bugs,
  one name.

## Done when

```bash
pnpm run typecheck           # catches a key missing from en or ru
pnpm run audit:invariants    # catches a key missing from all three
pnpm test:unit
```
