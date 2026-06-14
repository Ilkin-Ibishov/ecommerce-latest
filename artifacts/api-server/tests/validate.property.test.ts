import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { validate } from "../src/middlewares/validate";

/**
 * Validation Middleware Property Tests
 * Feature: architecture-refactoring, Property 8: Validation middleware partitions inputs correctly
 *
 * **Validates: Requirements 11.3, 11.4**
 *
 * For any request body, `validate(schema)` either:
 *   (a) passes schema validation → calls `next()` exactly once AND attaches the
 *       parsed value to `req.validatedBody` AND does not send a response, or
 *   (b) fails validation → responds `400` with an `{ error }` body AND does not
 *       call `next()`.
 * Never both, never neither.
 */

// ─── Schema under test ──────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string(),
  age: z.number(),
});

// ─── Fake req/res/next harness ────────────────────────────────────────────────

interface CapturedResponse {
  statusCode: number | null;
  jsonBody: unknown;
  responded: boolean;
}

function createHarness(body: unknown) {
  const req = { body } as unknown as Request & { validatedBody?: unknown };

  const captured: CapturedResponse = {
    statusCode: null,
    jsonBody: undefined,
    responded: false,
  };

  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.jsonBody = payload;
      captured.responded = true;
      return this;
    },
  } as unknown as Response;

  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

  return { req, res, next, captured };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Bodies that satisfy the schema: { name: string, age: number }. */
const validBodyArb = fc.record({
  name: fc.string(),
  age: fc.double({ noNaN: true, noDefaultInfinity: true }),
});

/**
 * Arbitrary bodies, the vast majority of which violate the schema (wrong types,
 * missing keys, primitives, arrays, null, extra-but-invalid shapes).
 */
const invalidBodyArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.anything()),
  // object missing required keys / wrong types
  fc.record({ name: fc.integer(), age: fc.string() }),
  fc.record({ name: fc.string() }),
  fc.record({ age: fc.double({ noNaN: true }) }),
  fc.object(),
);

/** Mix of valid and (mostly) invalid bodies. */
const anyBodyArb = fc.oneof(validBodyArb, invalidBodyArb);

// ─── Property 8 ────────────────────────────────────────────────────────────────

describe("Feature: architecture-refactoring, Property 8: Validation middleware partitions inputs correctly", () => {
  /**
   * **Validates: Requirements 11.3, 11.4**
   *
   * The middleware partitions every input into exactly one branch:
   *   pass → next() once + req.validatedBody set + no response
   *   fail → 400 { error } + next() never called
   */
  it("partitions any body into exactly one of {pass→next} or {fail→400}", () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        const { req, res, next, captured } = createHarness(body);

        validate(schema)(req, res, next);

        const expectedSuccess = schema.safeParse(body).success;

        if (expectedSuccess) {
          // (a) passes: next exactly once, validatedBody attached, no response
          expect(next).toHaveBeenCalledTimes(1);
          expect(captured.responded).toBe(false);
          expect(captured.statusCode).toBeNull();
          expect(req.validatedBody).toEqual(schema.parse(body));
        } else {
          // (b) fails: 400 { error }, next not called
          expect(next).not.toHaveBeenCalled();
          expect(captured.responded).toBe(true);
          expect(captured.statusCode).toBe(400);
          expect(captured.jsonBody).toHaveProperty("error");
          expect(req.validatedBody).toBeUndefined();
        }

        // The dichotomy: exactly one branch is taken — never both, never neither.
        const tookPassBranch =
          (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1 &&
          !captured.responded;
        const tookFailBranch =
          (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 0 &&
          captured.responded &&
          captured.statusCode === 400;
        expect(tookPassBranch !== tookFailBranch).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("valid bodies always pass: next() once, validatedBody set, no response", () => {
    fc.assert(
      fc.property(validBodyArb, (body) => {
        const { req, res, next, captured } = createHarness(body);

        validate(schema)(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.validatedBody).toEqual(body);
        expect(captured.responded).toBe(false);
        expect(captured.statusCode).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("invalid bodies always fail: 400 { error }, next() never called", () => {
    fc.assert(
      fc.property(invalidBodyArb, (body) => {
        // Skip the rare case where the generator emits a schema-valid object.
        fc.pre(!schema.safeParse(body).success);

        const { req, res, next, captured } = createHarness(body);

        validate(schema)(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(captured.statusCode).toBe(400);
        expect(captured.jsonBody).toHaveProperty("error");
        expect(typeof (captured.jsonBody as { error: unknown }).error).toBe("string");
        expect(req.validatedBody).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  // ─── Example tests ─────────────────────────────────────────────────────────

  it("example: a valid body { name, age } passes and attaches validatedBody", () => {
    const { req, res, next, captured } = createHarness({ name: "Ada", age: 36 });

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.validatedBody).toEqual({ name: "Ada", age: 36 });
    expect(captured.responded).toBe(false);
  });

  it("example: a body with wrong types responds 400 { error } without calling next()", () => {
    const { req, res, next, captured } = createHarness({ name: 123, age: "old" });

    validate(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(400);
    expect(captured.jsonBody).toHaveProperty("error");
    expect(req.validatedBody).toBeUndefined();
  });

  it("example: a non-object body (null) responds 400 without calling next()", () => {
    const { req, res, next, captured } = createHarness(null);

    validate(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(400);
    expect(captured.jsonBody).toHaveProperty("error");
  });
});
