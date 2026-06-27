import rateLimit from "express-rate-limit";

/**
 * Test-only bypass for the auth rate limiter.
 *
 * The `api-integration` CI job drives ~12 login-using suites from a single IP
 * with test shuffling on, so it legitimately exceeds the 10 req/min auth cap
 * and trips a 429 (window 60s > vitest 30s timeout, so retry can't recover).
 *
 * This bypass activates ONLY when `E2E_DISABLE_AUTH_RATELIMIT === "1"`, which is
 * set exclusively in the CI "Start API server" step. It MUST NOT be set in any
 * production environment (Vercel / Railway), or the SEC-004 protection is off.
 */
const authRateLimitDisabled = process.env.E2E_DISABLE_AUTH_RATELIMIT === "1";

// SEC-004: Strict rate limit for auth routes (10 req/min per IP)
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
  skip: () => authRateLimitDisabled,
});

// SEC-004: Rate limit for order creation (10 req/min per IP)
export const orderRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many order requests, please try again later" },
});

// SEC-007: Strict rate limit for coupon validation (5 req/min per IP)
export const couponValidateRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many coupon validation attempts, please try again later" },
});
