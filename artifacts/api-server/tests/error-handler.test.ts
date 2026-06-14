import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../src/middlewares/errorHandler.ts";

/**
 * Tests for the central error handler middleware (R4).
 *
 * The handler must:
 *  - respond with HTTP 500 and the generic body `{ error: "Internal server error" }`
 *  - never leak `err.message` or `err.stack` into the response body
 *  - log the full error detail via `req.log.error`
 *  - short-circuit when `res.headersSent` is true
 */

// ─── Test doubles ────────────────────────────────────────────────────────────

interface FakeResult {
  statusCode: number | null;
  body: unknown;
  logSpy: ReturnType<typeof vi.fn>;
  req: Request;
  res: Response;
  next: NextFunction;
}

/**
 * Build a fake req/res/next trio that records what the middleware does, so the
 * handler can be exercised in isolation without a live Express server.
 */
function makeFakes(headersSent = false): FakeResult {
  const logSpy = vi.fn();

  const req = {
    log: { error: logSpy },
  } as unknown as Request;

  const captured: { statusCode: number | null; body: unknown } = {
    statusCode: null,
    body: undefined,
  };

  const res = {
    headersSent,
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;

  const next = vi.fn() as unknown as NextFunction;

  return {
    get statusCode() {
      return captured.statusCode;
    },
    get body() {
      return captured.body;
    },
    logSpy,
    req,
    res,
    next,
  } as unknown as FakeResult;
}

// ─── Property 3: never leaks internal error detail ────────────────────────────

describe("Feature: architecture-refactoring, Property 3: The error handler never leaks internal error detail", () => {
  /**
   * For any error carrying arbitrary `message` and `stack` strings, the response
   * body produced by errorHandler contains neither the message nor the stack
   * substring and equals `{ error: "Internal server error" }`, while the full
   * detail is passed to `req.log.error`.
   *
   * **Validates: Requirements 4.2, 4.3, 4.4**
   */
  it("response body is always the generic message and never contains err.message or err.stack", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (message, stack) => {
        const fakes = makeFakes(false);
        const err = { message, stack };

        errorHandler(err, fakes.req, fakes.res, fakes.next);

        // Status is always 500 and the body is byte-for-byte the fixed generic
        // shape. Because the body is a hardcoded constant that does not depend
        // on `err` in any way, this deep-equality is itself the strongest proof
        // that no internal detail (message/stack) can ever be encoded into it.
        expect(fakes.statusCode).toBe(500);
        expect(fakes.body).toEqual({ error: "Internal server error" });

        // No-leak invariant: the body must never contain the message/stack as a
        // substring *beyond* fragments that are coincidentally part of the fixed
        // generic text (e.g. " " or "error" are substrings of "Internal server
        // error" but are not leaked detail). A genuine leak is the body
        // containing the detail string while that string is NOT a substring of
        // the generic body itself.
        const serialized = JSON.stringify(fakes.body);
        const genericSerialized = JSON.stringify({ error: "Internal server error" });

        const messageLeaked =
          serialized.includes(message) && !genericSerialized.includes(message);
        const stackLeaked =
          serialized.includes(stack) && !genericSerialized.includes(stack);

        expect(messageLeaked).toBe(false);
        expect(stackLeaked).toBe(false);

        // Full detail is logged via req.log.error.
        expect(fakes.logSpy).toHaveBeenCalledTimes(1);
        const [logPayload] = fakes.logSpy.mock.calls[0];
        expect(logPayload).toEqual({ err: { message, stack } });
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Example test (R4.7): throwing scenario returns 500 + logs detail ─────────

describe("errorHandler example behavior", () => {
  /**
   * A throwing scenario returns 500 with the generic `error` field, and a
   * `req.log.error` spy asserts the detail was logged.
   *
   * **Validates: Requirements 4.2, 4.3, 4.4, 4.7**
   */
  it("returns 500 with the generic error field and logs the thrown detail", () => {
    const fakes = makeFakes(false);
    const thrown = new Error("Database connection failed: secret-host:5432");

    errorHandler(thrown, fakes.req, fakes.res, fakes.next);

    // 500 with only the generic field.
    expect(fakes.statusCode).toBe(500);
    expect(fakes.body).toEqual({ error: "Internal server error" });

    // The sensitive message is not present in the response body.
    expect(JSON.stringify(fakes.body)).not.toContain("Database connection failed");

    // The detail (message + stack) was logged via req.log.error.
    expect(fakes.logSpy).toHaveBeenCalledTimes(1);
    const [logPayload, logMessage] = fakes.logSpy.mock.calls[0];
    expect(logPayload).toMatchObject({
      err: { message: "Database connection failed: secret-host:5432" },
    });
    expect((logPayload as { err: { stack?: string } }).err.stack).toBeDefined();
    expect(logMessage).toBe("Unhandled error");
  });

  it("short-circuits without sending a body when headers are already sent", () => {
    const fakes = makeFakes(true);
    const err = new Error("late failure");

    errorHandler(err, fakes.req, fakes.res, fakes.next);

    // The error is still logged...
    expect(fakes.logSpy).toHaveBeenCalledTimes(1);
    // ...but no status/body is written because the response already started.
    expect(fakes.statusCode).toBeNull();
    expect(fakes.body).toBeUndefined();
  });
});
