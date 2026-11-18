import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/errorHandler";

const app: Express = express();

// SEC-004: Trust proxy for correct client IP behind Vercel/Railway
app.set("trust proxy", 1);

// SEC-009: Security headers (before CORS)
app.use(helmet());

// SEC-003: Explicit CORS origin whitelist
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) || [];
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              callback(new Error("Not allowed by CORS"));
            }
          }
        : true,
    credentials: true,
  }),
);

// SEC-004: Global rate limit (100 req/min per IP).
// CI only: E2E_DISABLE_GLOBAL_RATELIMIT=1 lifts it, because parallel Playwright workers all reach
// the API from 127.0.0.1 and a 429 surfaces as a wrong UI state (the till shows "Not found").
// NEVER set it in production — same rule as E2E_DISABLE_AUTH_RATELIMIT (middlewares/rateLimits.ts).
const globalRateLimitDisabled = process.env.E2E_DISABLE_GLOBAL_RATELIMIT === "1";
app.use(
  rateLimit({
    skip: () => globalRateLimitDisabled,
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// SEC-012: Explicit JSON body size limit
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Central error handler — registered AFTER routes (R4.1); exactly one, last.
app.use(errorHandler);

export default app;
