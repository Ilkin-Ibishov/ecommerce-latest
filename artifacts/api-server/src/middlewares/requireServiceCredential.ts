/**
 * requireServiceCredential middleware — guards scheduler/system endpoints.
 *
 * Performs a constant-time comparison of the `X-Platform-Service-Token` header
 * (or `Authorization: Bearer ...`) against `PLATFORM_SCHEDULER_SECRET`.
 * On match: attaches `req.serviceActor = { type: 'system' }` and calls next().
 * On mismatch/missing: responds 403 { error: "Forbidden" }.
 *
 * No audit is needed for scheduler auth failures (shared secret, not user-facing).
 *
 * Feature: super-admin-platform
 * Requirements: 1.9
 */
import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Constant-time string comparison using Node's timingSafeEqual.
 * Returns false immediately only when the secret is not configured (length 0).
 * For actual comparisons, pads/truncates to equal lengths to avoid leaking
 * length information, then performs the timing-safe comparison.
 */
function safeCompare(provided: string, expected: string): boolean {
  if (expected.length === 0) return false;
  if (provided.length === 0) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  // If lengths differ, we still perform a constant-time comparison to avoid
  // leaking length information. Compare against the expected buffer using
  // a copy padded/truncated to match the provided buffer length.
  if (a.length !== b.length) {
    // Create a buffer of same length as `a` filled with the expected value
    // (cycle or truncate), then compare. This is always false but takes
    // constant time relative to the provided input length.
    const bPadded = Buffer.alloc(a.length);
    b.copy(bPadded, 0, 0, Math.min(b.length, a.length));
    timingSafeEqual(a, bPadded);
    return false;
  }

  return timingSafeEqual(a, b);
}

export async function requireServiceCredential(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const secret = process.env.PLATFORM_SCHEDULER_SECRET ?? "";

  // Accept the token from either the custom header or the Authorization bearer
  let provided: string | undefined = req.headers["x-platform-service-token"] as string | undefined;

  if (!provided) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      provided = authHeader.slice(7);
    }
  }

  if (!provided || !safeCompare(provided, secret)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  req.serviceActor = { type: "system" };
  next();
}
