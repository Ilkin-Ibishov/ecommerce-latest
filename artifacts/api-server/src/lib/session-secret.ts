import { createHmac } from "crypto";

/**
 * Validates that SESSION_SECRET is present and at least 32 characters long.
 * Throws an identifiable error if missing or weak.
 */
export function assertSessionSecret(secret?: string): string {
  const value = arguments.length > 0 ? secret : process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET environment variable is required but was not provided.");
  }
  if (value.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters long.");
  }
  return value;
}

/**
 * Derives a deterministic session password for a user using HMAC-SHA256.
 * Refuses to derive if SESSION_SECRET is absent or weak (< 32 characters).
 */
export function deriveSessionPassword(userId: string, secret?: string): string {
  const key = arguments.length > 1 ? assertSessionSecret(secret) : assertSessionSecret();
  return createHmac("sha256", key)
    .update(userId)
    .digest("hex")
    .slice(0, 32);
}
