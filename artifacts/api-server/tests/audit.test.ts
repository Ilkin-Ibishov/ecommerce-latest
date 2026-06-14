import { describe, it, expect, vi } from "vitest";
import type { Request } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { writeAudit, type AuditInput } from "../src/lib/audit.ts";

/**
 * Unit tests for the central audit-log helper `writeAudit` (R10, Design §9).
 *
 * `writeAudit` is fire-and-forget: it inserts a row into `audit_log` and returns
 * `void` immediately. The two behaviors under test are:
 *
 *  - Nominal: the insert payload maps AuditInput fields onto the audit_log
 *    columns (actorId→actor_id, action→action, entityType→entity,
 *    entityId→entity_id, details→changes).
 *  - Failure path: when the insert resolves `{ error }` (or rejects), the
 *    failure is logged via `req.log.error` and `writeAudit` never throws.
 *
 * **Validates: Requirements 10.4**
 */

// ─── Test doubles ────────────────────────────────────────────────────────────

/**
 * Flush pending microtasks so the fire-and-forget `.then`/`.catch` chain inside
 * `writeAudit` has run before we assert. A handful of awaited ticks covers the
 * `Promise.resolve(thenable).then(...).catch(...)` chain.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

/**
 * Build a fake admin Supabase client whose `.from("audit_log").insert(payload)`
 * records the table name + payload and resolves with the supplied result.
 *
 * `insertResult` controls the resolved/rejected value of the insert so the same
 * factory drives both the nominal (`{ error: null }`) and failure
 * (`{ error }` / rejection) paths.
 */
function makeFakeAdmin(insertResult: { mode: "resolve"; value: { error: unknown } } | { mode: "reject"; reason: unknown }) {
  const fromMock = vi.fn();
  const insertMock = vi.fn((payload: unknown) => {
    void payload;
    if (insertResult.mode === "reject") {
      return Promise.reject(insertResult.reason);
    }
    return Promise.resolve(insertResult.value);
  });

  fromMock.mockReturnValue({ insert: insertMock });

  const admin = { from: fromMock } as unknown as SupabaseClient<Database>;

  return { admin, fromMock, insertMock };
}

/** Build a fake request whose `log.error` is a spy. */
function makeFakeReq() {
  const errorSpy = vi.fn();
  const req = { log: { error: errorSpy } } as unknown as Request;
  return { req, errorSpy };
}

// ─── Nominal: correct column mapping ──────────────────────────────────────────

describe("writeAudit — nominal insert", () => {
  /**
   * For a fully-populated AuditInput, the recorded insert payload targets the
   * `audit_log` table and maps every field onto the correct column.
   *
   * **Validates: Requirements 10.4**
   */
  it("inserts an audit_log row with the correct column mapping", async () => {
    const { admin, fromMock, insertMock } = makeFakeAdmin({ mode: "resolve", value: { error: null } });
    const { req, errorSpy } = makeFakeReq();

    const input: AuditInput = {
      admin,
      req,
      actorId: "actor-123",
      action: "update_order_status",
      entityType: "order",
      entityId: "order-456",
      details: { from: "pending", to: "shipped" },
    };

    const result = writeAudit(input);

    // Fire-and-forget: returns void synchronously.
    expect(result).toBeUndefined();

    // Insert targets the audit_log table exactly once.
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("audit_log");
    expect(insertMock).toHaveBeenCalledTimes(1);

    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({
      actor_id: "actor-123",
      action: "update_order_status",
      entity: "order",
      entity_id: "order-456",
      changes: { from: "pending", to: "shipped" },
    });

    await flushMicrotasks();

    // A successful insert (`{ error: null }`) logs nothing.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  /**
   * Optional fields default safely: omitted `entityId` maps to `null` and
   * omitted `details` maps to an empty `changes` object.
   *
   * **Validates: Requirements 10.4**
   */
  it("defaults entityId to null and details to {} when omitted", async () => {
    const { admin, insertMock } = makeFakeAdmin({ mode: "resolve", value: { error: null } });
    const { req } = makeFakeReq();

    writeAudit({
      admin,
      req,
      actorId: "actor-1",
      action: "bulk_update_products",
      entityType: "product",
    });

    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({
      actor_id: "actor-1",
      action: "bulk_update_products",
      entity: "product",
      entity_id: null,
      changes: {},
    });

    await flushMicrotasks();
  });
});

// ─── Failure path: log via req.log.error, never throw ─────────────────────────

describe("writeAudit — failure path", () => {
  /**
   * When the insert resolves `{ error }`, the failure is reported via
   * `req.log.error` and `writeAudit` does not throw.
   *
   * **Validates: Requirements 10.4**
   */
  it("logs via req.log.error when the insert resolves with an error", async () => {
    const insertError = { message: "duplicate key", code: "23505" };
    const { admin } = makeFakeAdmin({ mode: "resolve", value: { error: insertError } });
    const { req, errorSpy } = makeFakeReq();

    expect(() =>
      writeAudit({
        admin,
        req,
        actorId: "actor-9",
        action: "create_product",
        entityType: "product",
        entityId: "product-1",
        details: { name: "Widget" },
      }),
    ).not.toThrow();

    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logPayload, logMessage] = errorSpy.mock.calls[0];
    expect(logPayload).toEqual({ err: insertError });
    expect(logMessage).toBe("audit write failed");
  });

  /**
   * When the insert rejects (thrown/async failure), the rejection is caught and
   * logged via `req.log.error`, and `writeAudit` does not throw.
   *
   * **Validates: Requirements 10.4**
   */
  it("logs via req.log.error when the insert rejects, without throwing", async () => {
    const rejection = new Error("network down");
    const { admin } = makeFakeAdmin({ mode: "reject", reason: rejection });
    const { req, errorSpy } = makeFakeReq();

    expect(() =>
      writeAudit({
        admin,
        req,
        actorId: "actor-7",
        action: "delete_coupon",
        entityType: "coupon",
        entityId: "coupon-2",
      }),
    ).not.toThrow();

    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logPayload, logMessage] = errorSpy.mock.calls[0];
    expect(logPayload).toEqual({ err: rejection });
    expect(logMessage).toBe("audit write failed");
  });
});
