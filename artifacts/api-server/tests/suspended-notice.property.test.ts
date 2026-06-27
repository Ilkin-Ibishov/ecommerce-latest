import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateGate,
  type OperationKind,
} from "../src/lib/store-hooks/platform-status";
import type { PlatformStatus } from "../src/lib/platform/lifecycle";

/**
 * Suspended Storefront Notice Property Tests
 * Feature: super-admin-platform, Property 15: Suspended storefront renders a localized notice with 503
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.5**
 *
 * For any storefront request to a `suspended` Store, the response SHALL be HTTP 503
 * carrying the localized suspended notice and excluding product, cart, and checkout
 * content, with the locale resolved from the active locale prefix and defaulting to
 * `az` when undefined or unsupported.
 *
 * The 503-for-storefront-read decision is the real shipped gate
 * (`evaluateGate(status, 'storefront_read')`). The localized notice is resolved by
 * mirroring the store package's `getT(locale)` semantics — `messages[locale] ?? messages.az`
 * — using the exact `SuspendedNotice.{title,message}` strings shipped in
 * `artifacts/store/src/lib/i18n/messages/{az,ru,en}.ts`. This mirrors the house pattern
 * of replicating pure resolution logic in the property test (see audit-logging.property.test.ts).
 */

// ─── Localized notice bundles (mirror of store i18n SuspendedNotice keys) ───────

interface NoticeBundle {
  readonly title: string;
  readonly message: string;
}

const SUPPORTED_LOCALES = ["az", "ru", "en"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Exact strings shipped in artifacts/store/src/lib/i18n/messages/{az,ru,en}.ts
 * under the `SuspendedNotice` key. `az` is the source-of-truth / fallback locale.
 */
const SUSPENDED_NOTICE: Record<SupportedLocale, NoticeBundle> = {
  az: {
    title: "Mağaza müvəqqəti olaraq əlçatmazdır",
    message:
      "Bu mağaza hazırda xidmət göstərmir. Zəhmət olmasa daha sonra yenidən yoxlayın.",
  },
  ru: {
    title: "Магазин временно недоступен",
    message:
      "Этот магазин в настоящее время не обслуживает. Пожалуйста, проверьте позже.",
  },
  en: {
    title: "Store Temporarily Unavailable",
    message:
      "This store is currently suspended. Please contact the platform administrator.",
  },
};

const DEFAULT_LOCALE: SupportedLocale = "az";

/**
 * Mirror of getT(locale)'s locale resolution: an unknown/undefined locale falls back
 * to the `az` bundle (`messages[locale] ?? messages.az`).
 */
function resolveNotice(locale: string | undefined): NoticeBundle {
  if (locale != null && (SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return SUSPENDED_NOTICE[locale as SupportedLocale];
  }
  return SUSPENDED_NOTICE[DEFAULT_LOCALE];
}

/**
 * Model of the suspended-storefront response wiring: when the platform-status gate
 * denies a storefront read, the storefront renders ONLY the localized notice
 * (the SuspendedNotice component replaces all product/cart/checkout content).
 */
type StorefrontResponse =
  | { httpStatus: 503; notice: NoticeBundle }
  | { httpStatus: 200; products: unknown[]; cart: unknown; checkout: unknown };

function renderStorefront(
  status: PlatformStatus,
  locale: string | undefined,
): StorefrontResponse {
  const decision = evaluateGate(status, "storefront_read");
  if (!decision.allowed) {
    // Suspended (503) → notice only, no storefront content.
    return { httpStatus: decision.httpStatus as 503, notice: resolveNotice(locale) };
  }
  // Permitted → normal storefront content (modelled).
  return { httpStatus: 200, products: [], cart: {}, checkout: {} };
}

// ─── Generators ────────────────────────────────────────────────────────────────

const knownLocaleArb: fc.Arbitrary<string> = fc.constantFrom(...SUPPORTED_LOCALES);

/** Locale codes / strings that are NOT supported → must fall back to `az`. */
const unknownLocaleArb: fc.Arbitrary<string> = fc
  .oneof(
    // Plausible-but-unsupported locale codes
    fc.constantFrom("fr", "de", "tr", "es", "ar", "AZ", "RU", "EN", "az-AZ", "en-US"),
    // Arbitrary strings
    fc.string(),
    // Empty string (undefined-ish prefix)
    fc.constant(""),
  )
  .filter((s) => !(SUPPORTED_LOCALES as readonly string[]).includes(s));

/** Active locale prefix: supported, unsupported, or undefined. */
const localeArb: fc.Arbitrary<string | undefined> = fc.oneof(
  knownLocaleArb,
  unknownLocaleArb,
  fc.constant(undefined),
);

const operationKindArb: fc.Arbitrary<OperationKind> = fc.constantFrom(
  "admin_read",
  "admin_write",
  "storefront_read",
  "order_submit",
);

// ─── Property 15 ─────────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 15: Suspended storefront renders a localized notice with 503", () => {
  /**
   * **Validates: Requirements 4.1**
   *
   * For a suspended Store, the storefront_read gate decision yields HTTP 503
   * (and is not allowed) — for any active locale prefix.
   */
  it("suspended + storefront_read → not allowed with HTTP 503", () => {
    fc.assert(
      fc.property(localeArb, () => {
        const decision = evaluateGate("suspended", "storefront_read");
        expect(decision.allowed).toBe(false);
        if (!decision.allowed) {
          expect(decision.httpStatus).toBe(503);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.2, 4.5**
   *
   * The localized notice resolves to a non-empty localized string, using the
   * locale's own bundle for supported locales and the `az` fallback for
   * undefined/unsupported locales.
   */
  it("notice resolves to non-empty localized strings with az fallback for unknown/undefined locales", () => {
    fc.assert(
      fc.property(localeArb, (locale) => {
        const notice = resolveNotice(locale);

        // Always a non-empty localized string.
        expect(typeof notice.title).toBe("string");
        expect(typeof notice.message).toBe("string");
        expect(notice.title.trim().length).toBeGreaterThan(0);
        expect(notice.message.trim().length).toBeGreaterThan(0);

        const isSupported =
          locale != null &&
          (SUPPORTED_LOCALES as readonly string[]).includes(locale);

        if (isSupported) {
          expect(notice).toEqual(SUSPENDED_NOTICE[locale as SupportedLocale]);
        } else {
          // Unknown or undefined → az fallback.
          expect(notice).toEqual(SUSPENDED_NOTICE.az);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * Specifically: every unsupported/undefined locale falls back to `az` exactly.
   */
  it("every unsupported or undefined locale falls back to the az notice", () => {
    fc.assert(
      fc.property(fc.oneof(unknownLocaleArb, fc.constant(undefined)), (locale) => {
        expect(resolveNotice(locale)).toEqual(SUSPENDED_NOTICE.az);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.2, 4.3**
   *
   * The suspended storefront response is HTTP 503, carries the localized notice,
   * and excludes product/cart/checkout content entirely.
   */
  it("suspended storefront response is 503 with the localized notice and no product/cart/checkout content", () => {
    fc.assert(
      fc.property(localeArb, (locale) => {
        const response = renderStorefront("suspended", locale);

        // 503 carrying the notice.
        expect(response.httpStatus).toBe(503);
        expect(response).toHaveProperty("notice");
        expect(response).not.toHaveProperty("products");
        expect(response).not.toHaveProperty("cart");
        expect(response).not.toHaveProperty("checkout");

        // Notice matches the resolved locale bundle (az fallback for unknown).
        if (response.httpStatus === 503) {
          expect(response.notice).toEqual(resolveNotice(locale));
          expect(response.notice.title.trim().length).toBeGreaterThan(0);
          expect(response.notice.message.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * The serialized suspended response never contains product/cart/checkout markers,
   * regardless of locale — the notice text alone is delivered.
   */
  it("serialized suspended response exposes no product/cart/checkout markers", () => {
    fc.assert(
      fc.property(localeArb, (locale) => {
        const response = renderStorefront("suspended", locale);
        const keys = Object.keys(response);
        expect(keys).not.toContain("products");
        expect(keys).not.toContain("cart");
        expect(keys).not.toContain("checkout");
        // The only payload alongside the status is the notice.
        expect(keys.sort()).toEqual(["httpStatus", "notice"]);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.4**
   *
   * The 503-for-storefront-read behavior is distinct from the 403 returned for
   * admin writes and order submissions on a suspended Store.
   */
  it("storefront_read yields 503 while admin_write and order_submit yield 403 on a suspended store", () => {
    fc.assert(
      fc.property(operationKindArb, (operation) => {
        const decision = evaluateGate("suspended", operation);

        if (operation === "storefront_read") {
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) {
            expect(decision.httpStatus).toBe(503);
          }
        } else if (operation === "admin_write" || operation === "order_submit") {
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) {
            expect(decision.httpStatus).toBe(403);
          }
        } else {
          // admin_read is permitted on a suspended store.
          expect(decision.allowed).toBe(true);
        }

        // The storefront 503 is never a 403, and vice versa.
        const storefront = evaluateGate("suspended", "storefront_read");
        if (!storefront.allowed) {
          expect(storefront.httpStatus).not.toBe(403);
          expect(storefront.httpStatus).toBe(503);
        }
      }),
      { numRuns: 100 },
    );
  });
});
