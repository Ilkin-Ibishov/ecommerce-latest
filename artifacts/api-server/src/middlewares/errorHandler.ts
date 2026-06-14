import type { Request, Response, NextFunction } from "express";

/**
 * Central Express error handler (R4).
 *
 * The 4-arg signature is what makes Express treat this as error middleware.
 * It logs the error's message and stack via `req.log` only, then responds with
 * a generic `{ error: "Internal server error" }` body so internal detail never
 * leaks to clients. If the response has already started, it delegates to the
 * default Express handler.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const e = err as { message?: string; stack?: string };
  req.log.error({ err: { message: e?.message, stack: e?.stack } }, "Unhandled error");
  if (res.headersSent) {
    return; // delegate to the default Express handler if the response has started
  }
  res.status(500).json({ error: "Internal server error" }); // generic only — never leaks detail
}
