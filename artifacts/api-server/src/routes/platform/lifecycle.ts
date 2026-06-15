/**
 * Store lifecycle routes — create, activate, suspend, reactivate, disable,
 * subscription-status update, and plan assignment.
 *
 * Feature: super-admin-platform
 * Requirements: 3.1, 3.2, 3.6, 3.8, 3.9, 3.10, 5.1, 5.2, 5.3, 5.4, 5.7, 5.8, 5.9, 5.10, 6.2, 6.3, 6.4, 6.6, 6.7, 6.9, 13.8, 13.14
 *
 * All routes require `requireSuperAdmin`. Bodies are validated with Zod via
 * the house `validate(schema)` middleware. Every status change is audited via
 * `writePlatformAudit`. Store creation is registry-only — no infrastructure
 * provisioning is triggered.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { validate } from "../../middlewares/validate";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import {
  transitionPlatformStatus,
  createStoreDefaults,
  checkNameCollision,
  type PlatformStatus,
} from "../../lib/platform/lifecycle";
import {
  validateSubscriptionStatusUpdate,
} from "../../lib/platform/subscription";
import { canAssignPlan, type PlanRecord } from "../../lib/platform/plans";
import { writePlatformAudit } from "../../lib/platform/audit";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const SubscriptionStatusUpdateSchema = z.object({
  subscription_status: z.enum(["trialing", "active", "past_due", "cancelled"], {
    required_error: "subscription_status is required",
    invalid_type_error:
      "Subscription status must be one of: trialing, active, past_due, cancelled",
  }),
});

export const AssignPlanSchema = z.object({
  plan_id: z
    .string({ required_error: "plan_id is required" })
    .uuid("plan_id must be a valid UUID"),
});

export const CreateStoreSchema = z.object({
  name: z
    .string({ required_error: "name is required" })
    .min(1, "name must be 1 to 120 characters")
    .max(120, "name must be 1 to 120 characters"),
  owner_email: z
    .string({ required_error: "owner_email is required" })
    .email("owner_email must be a valid email"),
  instance_url: z
    .string({ required_error: "instance_url is required" })
    .url("instance_url must be a valid URL"),
  metrics_endpoint_url: z
    .string({ required_error: "metrics_endpoint_url is required" })
    .url("metrics_endpoint_url must be a valid URL"),
  per_store_credential_hash: z
    .string({ required_error: "per_store_credential_hash is required" })
    .min(1, "per_store_credential_hash must not be empty"),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /platform/stores — Create a Store_Registry entry (R5.1, R5.9, R5.10, R6.2)
// ---------------------------------------------------------------------------
router.post(
  "/platform/stores",
  requireSuperAdmin,
  validate(CreateStoreSchema),
  async (req, res): Promise<void> => {
    const body = req.validatedBody as z.infer<typeof CreateStoreSchema>;
    const cp = getControlPlaneSupabase();

    // Case-insensitive name collision check (R5.6)
    const { data: existingStores, error: fetchError } = await cp
      .from("stores")
      .select("name_normalized");

    if (fetchError) {
      req.log?.error?.({ err: fetchError }, "failed to fetch stores for collision check");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const existingNames = (existingStores ?? []).map((s) => s.name_normalized);
    if (checkNameCollision(body.name, existingNames)) {
      res.status(409).json({ error: "A store with this name already exists" });
      return;
    }

    // Defaults for new store (R5.1, R6.2)
    const defaults = createStoreDefaults();

    const { data: inserted, error: insertError } = await cp
      .from("stores")
      .insert({
        name: body.name,
        name_normalized: body.name.toLowerCase(),
        instance_url: body.instance_url,
        metrics_endpoint_url: body.metrics_endpoint_url,
        per_store_credential_hash: body.per_store_credential_hash,
        owner_email: body.owner_email,
        platform_status: defaults.platformStatus,
        subscription_status: defaults.subscriptionStatus,
      })
      .select("id, name, platform_status, subscription_status, created_at")
      .single();

    if (insertError || !inserted) {
      req.log?.error?.({ err: insertError }, "store creation failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the creation (R5.8)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "create_store",
      entity: "store",
      entityId: inserted.id,
      storeId: inserted.id,
      changes: {
        prior_status: null,
        new_platform_status: defaults.platformStatus,
        new_subscription_status: defaults.subscriptionStatus,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(201).json({ data: inserted });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/stores/:id/activate — onboarding → active (R5.2)
// ---------------------------------------------------------------------------
router.post(
  "/platform/stores/:id/activate",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Fetch the store (R3.10 → 404 on unknown)
    const { data: store, error: fetchError } = await cp
      .from("stores")
      .select("id, platform_status")
      .eq("id", storeId)
      .single();

    if (fetchError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    const priorStatus: PlatformStatus = store.platform_status;
    const result = transitionPlatformStatus(priorStatus, "activate");

    if (!result.success) {
      // Illegal transition → 409 (R5.3)
      res.status(409).json({
        error: result.reason === "already_in_state"
          ? `Store is already ${priorStatus}`
          : `Cannot activate a store with status '${priorStatus}'`,
      });
      return;
    }

    // Apply the transition
    const { error: updateError } = await cp
      .from("stores")
      .update({ platform_status: result.newStatus })
      .eq("id", storeId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "store activation update failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the status change (R5.8)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "activate_store",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        prior_status: priorStatus,
        new_status: result.newStatus,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({
      data: { id: storeId, platform_status: result.newStatus },
    });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/stores/:id/suspend — →suspended ≤5s; idempotent (R3.1, R3.8)
// ---------------------------------------------------------------------------
router.post(
  "/platform/stores/:id/suspend",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Fetch the store (R3.10 → 404 on unknown)
    const { data: store, error: fetchError } = await cp
      .from("stores")
      .select("id, platform_status")
      .eq("id", storeId)
      .single();

    if (fetchError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    const priorStatus: PlatformStatus = store.platform_status;
    const result = transitionPlatformStatus(priorStatus, "suspend");

    if (!result.success) {
      if (result.reason === "already_in_state") {
        // Idempotent success (R3.8)
        res.status(200).json({
          data: { id: storeId, platform_status: "suspended" },
          message: "Store is already suspended",
        });
        return;
      }
      // Illegal transition → 409
      res.status(409).json({
        error: `Cannot suspend a store with status '${priorStatus}'`,
      });
      return;
    }

    // Apply the transition: set suspended status + metadata
    const now = new Date().toISOString();
    const { error: updateError } = await cp
      .from("stores")
      .update({
        platform_status: result.newStatus,
        suspended_at: now,
        status_before_suspend: priorStatus,
      })
      .eq("id", storeId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "store suspend update failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the status change (R3.6)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "suspend_store",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        prior_status: priorStatus,
        new_status: result.newStatus,
        timestamp: now,
      },
    });

    res.status(200).json({
      data: { id: storeId, platform_status: result.newStatus },
    });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/stores/:id/reactivate — suspended→active ≤5s; idempotent (R3.2, R3.9)
// ---------------------------------------------------------------------------
router.post(
  "/platform/stores/:id/reactivate",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Fetch the store (R3.10 → 404 on unknown)
    const { data: store, error: fetchError } = await cp
      .from("stores")
      .select("id, platform_status")
      .eq("id", storeId)
      .single();

    if (fetchError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    const priorStatus: PlatformStatus = store.platform_status;
    const result = transitionPlatformStatus(priorStatus, "reactivate");

    if (!result.success) {
      if (result.reason === "already_in_state") {
        // Idempotent success (R3.9)
        res.status(200).json({
          data: { id: storeId, platform_status: "active" },
          message: "Store is already active",
        });
        return;
      }
      // Illegal transition → 409
      res.status(409).json({
        error: `Cannot reactivate a store with status '${priorStatus}'`,
      });
      return;
    }

    // Apply the transition: clear suspension metadata
    const now = new Date().toISOString();
    const { error: updateError } = await cp
      .from("stores")
      .update({
        platform_status: result.newStatus,
        suspended_at: null,
        status_before_suspend: null,
      })
      .eq("id", storeId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "store reactivate update failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the status change (R3.6)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "reactivate_store",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        prior_status: priorStatus,
        new_status: result.newStatus,
        timestamp: now,
      },
    });

    res.status(200).json({
      data: { id: storeId, platform_status: result.newStatus },
    });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/stores/:id/disable — active|suspended → disabled (R5.4)
// ---------------------------------------------------------------------------
router.post(
  "/platform/stores/:id/disable",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Fetch the store (R3.10 → 404 on unknown)
    const { data: store, error: fetchError } = await cp
      .from("stores")
      .select("id, platform_status")
      .eq("id", storeId)
      .single();

    if (fetchError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    const priorStatus: PlatformStatus = store.platform_status;
    const result = transitionPlatformStatus(priorStatus, "disable");

    if (!result.success) {
      // Illegal transition or already disabled → 409 (R5.3)
      res.status(409).json({
        error: result.reason === "already_in_state"
          ? `Store is already ${priorStatus}`
          : `Cannot disable a store with status '${priorStatus}'`,
      });
      return;
    }

    // Apply the transition
    const { error: updateError } = await cp
      .from("stores")
      .update({ platform_status: result.newStatus })
      .eq("id", storeId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "store disable update failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the status change (R5.8)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "disable_store",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        prior_status: priorStatus,
        new_status: result.newStatus,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({
      data: { id: storeId, platform_status: result.newStatus },
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH /platform/stores/:id/subscription-status — set subscription_status (R6.3, R6.4, R6.9)
// ---------------------------------------------------------------------------
router.patch(
  "/platform/stores/:id/subscription-status",
  requireSuperAdmin,
  validate(SubscriptionStatusUpdateSchema),
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = req.validatedBody as z.infer<typeof SubscriptionStatusUpdateSchema>;
    const cp = getControlPlaneSupabase();

    // Fetch the store
    const { data: store, error: fetchError } = await cp
      .from("stores")
      .select("id, subscription_status")
      .eq("id", storeId)
      .single();

    if (fetchError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Validate the update using the pure function
    const result = validateSubscriptionStatusUpdate({
      newStatus: body.subscription_status,
      storeExists: true,
    });

    if (!result.valid) {
      res.status(result.httpStatus).json({ error: result.error });
      return;
    }

    const priorStatus = store.subscription_status;

    // Persist atomically (R6.9)
    const { error: updateError } = await cp
      .from("stores")
      .update({ subscription_status: result.newStatus })
      .eq("id", storeId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "subscription status update failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the change (R6.4)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "update_subscription_status",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        prior_subscription_status: priorStatus,
        new_subscription_status: result.newStatus,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({
      data: { id: storeId, subscription_status: result.newStatus },
    });
  },
);

// ---------------------------------------------------------------------------
// PUT /platform/stores/:id/plan — assign/change plan (R13.8, R13.14, R13.10)
// ---------------------------------------------------------------------------
router.put(
  "/platform/stores/:id/plan",
  requireSuperAdmin,
  validate(AssignPlanSchema),
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = req.validatedBody as z.infer<typeof AssignPlanSchema>;
    const cp = getControlPlaneSupabase();

    // Fetch the store
    const { data: store, error: fetchStoreError } = await cp
      .from("stores")
      .select("id, subscription_plan_id")
      .eq("id", storeId)
      .single();

    if (fetchStoreError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Fetch all plans for the guard check
    const { data: plans, error: fetchPlansError } = await cp
      .from("subscription_plans")
      .select("id, name, name_normalized, price, billing_interval, feature_flags, quota_limits, archived");

    if (fetchPlansError) {
      req.log?.error?.({ err: fetchPlansError }, "failed to fetch plans for assignment");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const planRecords: PlanRecord[] = (plans ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      name_normalized: p.name_normalized,
      price: Number(p.price),
      billing_interval: p.billing_interval as "monthly" | "yearly",
      feature_flags: (p.feature_flags ?? {}) as Record<string, boolean>,
      quota_limits: (p.quota_limits ?? {}) as Record<string, number>,
      archived: p.archived,
    }));

    // Guard: plan must exist and not be archived (R13.8, R13.14)
    const assignCheck = canAssignPlan(body.plan_id, planRecords);
    if (!assignCheck.success) {
      res.status(assignCheck.httpStatus).json({ error: assignCheck.error });
      return;
    }

    const priorPlanId = store.subscription_plan_id;

    // Persist the plan assignment
    const { error: updateError } = await cp
      .from("stores")
      .update({ subscription_plan_id: body.plan_id })
      .eq("id", storeId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "plan assignment failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the assignment (R13.10)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "assign_plan",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        prior_plan_id: priorPlanId,
        new_plan_id: body.plan_id,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({
      data: { id: storeId, subscription_plan_id: body.plan_id },
    });
  },
);

export default router;
