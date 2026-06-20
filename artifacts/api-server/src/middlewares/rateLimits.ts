import rateLimit from "express-rate-limit";

// SEC-004: Strict rate limit for auth routes (10 req/min per IP)
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
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
