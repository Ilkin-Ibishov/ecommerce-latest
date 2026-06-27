import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

import {
  evaluateGate,
  type OperationKind,
} from "../src/lib/store-hooks/platform-status";
import type { PlatformStatus } from "../src/lib/platform/lifecycle";

/**
 * Suspended-Order Rejection Property Tests
 * Feature: super-admin-platform, Property 14: Suspended-Store order rejection is atomic
 *
 * **Validates: Requirements 3.5, 4.4**
 *
 * For any order submission to a Store whose status is `suspended`, the outcome SHALL be
 * a single atomic result: HTTP 403, no order record created or modified, and no stock
 * decremented — these occur jointly or not at all (the gate runs BEFORE any
 * `decrement_stock_safe` call).
 */

// ─── Model the store-side order-submit decision as a pure flow ─────────────────
//
// This mirrors the real wiring (task 9.2): the order-submit handler evaluates the
// platform-status self-gate (`evaluateGate(status, 'order_submit')`) and ONLY proceeds
// to create the order / decrement stock when the gate permits the operation. We capture
// that ordering invariant with two spied side effects whose invocation we can observe.

interface OrderSubmitOutcome {
  /** Whether the order path was permitted to proceed. */
  proceeded: boolean;
  /** HTTP status returned to the caller (403 when blocked, 201 when created). */
  httpStatus: number;
  /** True iff an order record was created. */
  orderCreated: boolean;
  /** True iff stock was decremented. */
  stockDecremented: boolean;
}

/**
 * Simulates the store-side order-submit path. The gate is evaluated strictly first;
 * the stock-decrement and order-create side effects fire only after the gate permits.
 * `effects.onDecrement` / `effects.onCreate` are vi.fn() spies so the test can assert
 * whether (and in what order) they were invoked.
 */
function submitOrder(
  status: PlatformStatus,
  effects: { onDecrement: () => void; onCreate: () => void },
): OrderSubmitOutcome {
  const decision = evaluateGate(status, "order_submit");

  if (!decision.allowed) {
    // Atomic reject: no side effects run at all.
    return {
      proceeded: false,
      httpStatus: decision.httpStatus,
      orderCreated: false,
      stockDecremented: false,
    };
  }

  // Gate permitted → proceed with the order path. The decrement MUST run before
  // the order is finalized, matching `decrement_stock_safe` ordering in the handler.
  effects.onDecrement();
  effects.onCreate();

  return {
    proceeded: true,
    httpStatus: 201,
    orderCreated: true,
    stockDecremented: true,
  };
}

// ─── Generators ────────────────────────────────────────────────────────────────

/** Any of the four platform statuses. */
const platformStatusArb: fc.Arbitrary<PlatformStatus> = fc.constantFrom(
  "onboarding",
  "active",
  "suspended",
  "disabled",
);

/** Any operation kind (used to assert order_submit is treated like a write). */
const operationKindArb: fc.Arbitrary<OperationKind> = fc.constantFrom(
  "admin_read",
  "admin_write",
  "storefront_read",
  "order_submit",
);

// ─── Property 14: Suspended-Store order rejection is atomic ────────────────────

describe("Feature: super-admin-platform, Property 14: Suspended-Store order rejection is atomic", () => {
  describe("Suspended store → atomic 403 reject (no order, no decrement)", () => {
    /**
     * **Validates: Requirements 3.5, 4.4**
     *
     * When the store is suspended, an order submission must yield a single atomic
     * outcome: 403, no order created, and no stock decremented. The gate is evaluated
     * before any side effect, so neither effect is ever invoked.
     */
    it("for a suspended store, order_submit blocks with 403 and runs no side effects", () => {
      fc.assert(
        fc.property(fc.integer(), (seed) => {
          // seed only varies the run; the status under test is fixed to 'suspended'
          void seed;
          const onDecrement = vi.fn();
          const onCreate = vi.fn();

          const outcome = submitOrder("suspended", { onDecrement, onCreate });

          // Single atomic reject: 403 + no order + no decrement, jointly.
          expect(outcome.proceeded).toBe(false);
          expect(outcome.httpStatus).toBe(403);
          expect(outcome.orderCreated).toBe(false);
          expect(outcome.stockDecremented).toBe(false);

          // The side effects were never invoked.
          expect(onDecrement).not.toHaveBeenCalled();
          expect(onCreate).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.5**
     *
     * The gate decision for a suspended order_submit is always exactly 403 — never 503
     * (which is reserved for storefront_read) and never permitted.
     */
    it("suspended + order_submit gate decision is always blocked with 403", () => {
      fc.assert(
        fc.property(fc.integer(), (seed) => {
          void seed;
          const decision = evaluateGate("suspended", "order_submit");
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) {
            expect(decision.httpStatus).toBe(403);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Non-suspended/non-disabled store → order path proceeds", () => {
    /**
     * **Validates: Requirements 4.4**
     *
     * For 'active' and 'onboarding' statuses, the order path proceeds: 201, order
     * created, and stock decremented — all side effects run.
     */
    it("for active/onboarding stores, order_submit proceeds and runs both side effects", () => {
      const allowedStatusArb = fc.constantFrom<PlatformStatus>("active", "onboarding");

      fc.assert(
        fc.property(allowedStatusArb, (status) => {
          const onDecrement = vi.fn();
          const onCreate = vi.fn();

          const outcome = submitOrder(status, { onDecrement, onCreate });

          expect(outcome.proceeded).toBe(true);
          expect(outcome.httpStatus).toBe(201);
          expect(outcome.orderCreated).toBe(true);
          expect(outcome.stockDecremented).toBe(true);

          expect(onDecrement).toHaveBeenCalledTimes(1);
          expect(onCreate).toHaveBeenCalledTimes(1);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.5, 4.4**
     *
     * A 'disabled' store also rejects atomically (403, no side effects). This confirms
     * the atomic-reject guarantee is not unique to 'suspended' — any blocking status
     * leaves zero side effects.
     */
    it("for a disabled store, order_submit blocks with 403 and runs no side effects", () => {
      fc.assert(
        fc.property(fc.integer(), (seed) => {
          void seed;
          const onDecrement = vi.fn();
          const onCreate = vi.fn();

          const outcome = submitOrder("disabled", { onDecrement, onCreate });

          expect(outcome.proceeded).toBe(false);
          expect(outcome.httpStatus).toBe(403);
          expect(outcome.orderCreated).toBe(false);
          expect(outcome.stockDecremented).toBe(false);
          expect(onDecrement).not.toHaveBeenCalled();
          expect(onCreate).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Ordering invariant — gate strictly precedes the decrement effect", () => {
    /**
     * **Validates: Requirements 3.5, 4.4**
     *
     * Across every platform status, the gate is evaluated BEFORE any stock decrement.
     * We assert this by checking the atomic coupling: stock is decremented IFF the gate
     * permitted the operation. There is no status where stock decrements while the order
     * is blocked, nor where the order is created without a decrement.
     */
    it("stock is decremented if and only if the gate permits the order", () => {
      fc.assert(
        fc.property(platformStatusArb, (status) => {
          const callOrder: string[] = [];
          const onDecrement = vi.fn(() => callOrder.push("decrement"));
          const onCreate = vi.fn(() => callOrder.push("create"));

          const decision = evaluateGate(status, "order_submit");
          const outcome = submitOrder(status, { onDecrement, onCreate });

          // Atomic coupling: every observable matches the single gate decision.
          expect(outcome.stockDecremented).toBe(decision.allowed);
          expect(outcome.orderCreated).toBe(decision.allowed);
          expect(outcome.proceeded).toBe(decision.allowed);

          if (decision.allowed) {
            // When permitted, decrement happens strictly before order creation.
            expect(callOrder).toEqual(["decrement", "create"]);
          } else {
            // When blocked, no effect runs at all and the status is 403.
            expect(callOrder).toEqual([]);
            expect(outcome.httpStatus).toBe(403);
          }
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.5**
     *
     * Sanity over the full operation space: order_submit is gated exactly like a write —
     * permitted for active/onboarding, blocked otherwise — confirming the decision the
     * atomic flow depends on is stable for the order_submit kind specifically.
     */
    it("order_submit is permitted exactly for active/onboarding across all statuses", () => {
      fc.assert(
        fc.property(platformStatusArb, operationKindArb, (status, op) => {
          const decision = evaluateGate(status, op);
          if (op === "order_submit") {
            const shouldAllow = status === "active" || status === "onboarding";
            expect(decision.allowed).toBe(shouldAllow);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
