/**
 * Platform route aggregator — mounted at /api/platform in `routes/index.ts`.
 *
 * Registers literal sub-paths BEFORE parameterized `:id` routes to prevent
 * Express 5 param shadowing.
 *
 * Feature: super-admin-platform
 */
import { Router, type IRouter } from "express";
import storeFeedRouter from "./store-feed";
import authRouter from "./auth";
import auditRouter from "./audit";
import notifyRouter from "./notify";
import metricsRouter from "./metrics";
import analyticsRouter from "./analytics";
import plansRouter from "./plans";
import billingRouter from "./billing";
import impersonationRouter from "./impersonation";
import offboardingRouter from "./offboarding";
import lifecycleRouter from "./lifecycle";
import storesRouter from "./stores";

const router: IRouter = Router();

// Register literal paths FIRST to avoid param shadowing by `:id` routes.

// Auth/MFA/session routes (literal paths: /platform/auth/*)
router.use(authRouter);

// Audit read route (literal path: /platform/audit)
router.use(auditRouter);

// Notification compose route (literal path: /platform/notifications, /platform/stores/:id/notification-preferences)
router.use(notifyRouter);

// Metrics polling (literal path: /platform/metrics/poll, requireServiceCredential)
router.use(metricsRouter);

// Analytics (literal path: /platform/analytics, requireSuperAdmin)
router.use(analyticsRouter);

// Store-facing endpoints (Per_Store_Credential auth, NOT requireSuperAdmin)
router.use(storeFeedRouter);

// Plans CRUD (literal path: /platform/plans, /platform/plans/:id — before lifecycle :id routes)
router.use(plansRouter);

// Billing routes (literal paths: /platform/billing/run, /platform/invoices/:id/pay — before lifecycle :id routes)
router.use(billingRouter);

// Impersonation routes (literal path: /platform/impersonation, /platform/impersonation/:id — before lifecycle :id routes)
router.use(impersonationRouter);

// Offboarding routes (/platform/stores/:id/offboard, export, restore, purge — before lifecycle :id routes)
router.use(offboardingRouter);

// Lifecycle routes (has /:id param routes — registered AFTER literals)
router.use(lifecycleRouter);

// Dashboard/detail routes (has /:id param routes — registered LAST in the aggregator)
router.use(storesRouter);

export default router;
