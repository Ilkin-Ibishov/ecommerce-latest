/**
 * Subscription plan CRUD routes — list, create, edit, archive, delete.
 *
 * Feature: super-admin-platform
 * Requirements: 6.3, 6.4, 6.6, 6.7, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.12, 13.13, 13.14
 *
 * All routes require `requireSuperAdmin`. Bodies are validated with Zod via
 * the house `validate(schema)` middleware. Every mutation is audited via
 * `writePlatformAudit`. Uses `getControlPlaneSupabase()` only.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { validate } from "../../middlewares/validate";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import {
  validatePlanCreate,
  validatePlanEdit,
  canArchivePlan,
  canDeletePlan,
  type PlanRecord,
} from "../../lib/platform/plans";
import { writePlatformAudit } from "../../lib/platform/audit";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreatePlanSchema = z.object({
  name: z
    .string({ required_error: "name is required" })
    .min(1, "name must be 1 to 120 characters")
    .max(120, "name must be 1 to 120 characters"),
  price: z
    .number({ required_error: "price is required" })
    .min(0, "price must be between 0 and 999999999.99")
    .max(999999999.99, "price must be between 0 and 999999999.99"),
  billing_interval: z.enum(["monthly", "yearly"], {
    required_error: "billing_interval is required",
    invalid_type_error: "billing_interval must be monthly or yearly",
  }),
  feature_flags: z.record(z.boolean()).optional().default({}),
  quota_limits: z.record(z.number()).optional().default({}),
});

const EditPlanSchema = z.object({
  name: z
    .string()
    .min(1, "name must be 1 to 120 characters")
    .max(120, "name must be 1 to 120 characters")
    .optional(),
  price: z
    .number()
    .min(0, "price must be between 0 and 999999999.99")
    .max(999999999.99, "price must be between 0 and 999999999.99")
    .optional(),
  billing_interval: z.enum(["monthly", "yearly"]).optional(),
  feature_flags: z.record(z.boolean()).optional(),
  quota_limits: z.record(z.number()).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /platform/plans — list all plans (R13.6: archived excluded from assignable)
// ---------------------------------------------------------------------------
router.get(
  "/platform/plans",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const cp = getControlPlaneSupabase();

    const { data: plans, error } = await cp
      .from("subscription_plans")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      req.log?.error?.({ err: error }, "failed to list plans");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Return all plans for management, but mark assignable status
    const result = (plans ?? []).map((plan) => ({
      ...plan,
      assignable: !plan.archived,
    }));

    res.json({ data: result });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/plans — create a plan (R13.1, R13.2, R13.3, R13.4, R13.10)
// ---------------------------------------------------------------------------
router.post(
  "/platform/plans",
  requireSuperAdmin,
  validate(CreatePlanSchema),
  async (req, res): Promise<void> => {
    const body = req.validatedBody as z.infer<typeof CreatePlanSchema>;
    const cp = getControlPlaneSupabase();

    // Fetch existing plans for collision check
    const { data: existingPlans, error: fetchError } = await cp
      .from("subscription_plans")
      .select("id, name, name_normalized, price, billing_interval, feature_flags, quota_limits, archived");

    if (fetchError) {
      req.log?.error?.({ err: fetchError }, "failed to fetch plans for collision check");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Map to PlanRecord for the pure validation
    const planRecords: PlanRecord[] = (existingPlans ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      name_normalized: p.name_normalized,
      price: Number(p.price),
      billing_interval: p.billing_interval as "monthly" | "yearly",
      feature_flags: (p.feature_flags ?? {}) as Record<string, boolean>,
      quota_limits: (p.quota_limits ?? {}) as Record<string, number>,
      archived: p.archived,
    }));

    const validation = validatePlanCreate(
      {
        name: body.name,
        price: body.price,
        billing_interval: body.billing_interval,
        feature_flags: body.feature_flags,
        quota_limits: body.quota_limits,
      },
      planRecords,
    );

    if (!validation.valid) {
      res.status(validation.httpStatus).json({ error: validation.errors.join("; ") });
      return;
    }

    // Insert the plan
    const nameNormalized = body.name.trim().toLowerCase();
    const { data: inserted, error: insertError } = await cp
      .from("subscription_plans")
      .insert({
        name: body.name.trim(),
        name_normalized: nameNormalized,
        price: body.price,
        billing_interval: body.billing_interval,
        feature_flags: body.feature_flags,
        quota_limits: body.quota_limits,
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      req.log?.error?.({ err: insertError }, "plan creation failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the creation (R13.10)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "create_plan",
      entity: "plan",
      entityId: inserted.id,
      changes: {
        name: inserted.name,
        price: Number(inserted.price),
        billing_interval: inserted.billing_interval,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(201).json({ data: inserted });
  },
);

// ---------------------------------------------------------------------------
// PATCH /platform/plans/:id — edit plan (R13.5, R13.3, R13.4, R13.10)
// ---------------------------------------------------------------------------
router.patch(
  "/platform/plans/:id",
  requireSuperAdmin,
  validate(EditPlanSchema),
  async (req, res): Promise<void> => {
    const planId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = req.validatedBody as z.infer<typeof EditPlanSchema>;
    const cp = getControlPlaneSupabase();

    // Fetch the current plan
    const { data: currentPlan, error: fetchCurrentError } = await cp
      .from("subscription_plans")
      .select("id, name, name_normalized, price, billing_interval, feature_flags, quota_limits, archived")
      .eq("id", planId)
      .single();

    if (fetchCurrentError || !currentPlan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    // Fetch all plans for collision check
    const { data: allPlans, error: fetchAllError } = await cp
      .from("subscription_plans")
      .select("id, name, name_normalized, price, billing_interval, feature_flags, quota_limits, archived");

    if (fetchAllError) {
      req.log?.error?.({ err: fetchAllError }, "failed to fetch plans for edit collision check");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const planRecords: PlanRecord[] = (allPlans ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      name_normalized: p.name_normalized,
      price: Number(p.price),
      billing_interval: p.billing_interval as "monthly" | "yearly",
      feature_flags: (p.feature_flags ?? {}) as Record<string, boolean>,
      quota_limits: (p.quota_limits ?? {}) as Record<string, number>,
      archived: p.archived,
    }));

    const currentRecord: PlanRecord = {
      id: currentPlan.id,
      name: currentPlan.name,
      name_normalized: currentPlan.name_normalized,
      price: Number(currentPlan.price),
      billing_interval: currentPlan.billing_interval as "monthly" | "yearly",
      feature_flags: (currentPlan.feature_flags ?? {}) as Record<string, boolean>,
      quota_limits: (currentPlan.quota_limits ?? {}) as Record<string, number>,
      archived: currentPlan.archived,
    };

    const validation = validatePlanEdit(body, currentRecord, planRecords);

    if (!validation.valid) {
      res.status(validation.httpStatus).json({ error: validation.errors.join("; ") });
      return;
    }

    // Build the update payload (only provided fields)
    const updatePayload: {
      name?: string;
      name_normalized?: string;
      price?: number;
      billing_interval?: "monthly" | "yearly";
      feature_flags?: Record<string, boolean>;
      quota_limits?: Record<string, number>;
    } = {};
    if (body.name !== undefined) {
      updatePayload.name = body.name.trim();
      updatePayload.name_normalized = body.name.trim().toLowerCase();
    }
    if (body.price !== undefined) {
      updatePayload.price = body.price;
    }
    if (body.billing_interval !== undefined) {
      updatePayload.billing_interval = body.billing_interval;
    }
    if (body.feature_flags !== undefined) {
      updatePayload.feature_flags = body.feature_flags;
    }
    if (body.quota_limits !== undefined) {
      updatePayload.quota_limits = body.quota_limits;
    }

    const { data: updated, error: updateError } = await cp
      .from("subscription_plans")
      .update(updatePayload)
      .eq("id", planId)
      .select("*")
      .single();

    if (updateError || !updated) {
      req.log?.error?.({ err: updateError }, "plan update failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the edit (R13.10)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "edit_plan",
      entity: "plan",
      entityId: planId,
      changes: {
        ...updatePayload,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({ data: updated });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/plans/:id/archive — archive plan (R13.6, R13.13, R13.10)
// ---------------------------------------------------------------------------
router.post(
  "/platform/plans/:id/archive",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const planId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Verify the plan exists
    const { data: plan, error: fetchError } = await cp
      .from("subscription_plans")
      .select("id, name, archived")
      .eq("id", planId)
      .single();

    if (fetchError || !plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    if (plan.archived) {
      res.json({ data: plan, message: "Plan is already archived" });
      return;
    }

    // Guard: count assigned stores (R13.13)
    const { count, error: countError } = await cp
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("subscription_plan_id", planId);

    if (countError) {
      req.log?.error?.({ err: countError }, "failed to count stores for archive guard");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const archiveCheck = canArchivePlan(planId, count ?? 0);
    if (!archiveCheck.success) {
      res.status(archiveCheck.httpStatus).json({ error: archiveCheck.error });
      return;
    }

    // Archive the plan
    const { data: updated, error: updateError } = await cp
      .from("subscription_plans")
      .update({ archived: true })
      .eq("id", planId)
      .select("*")
      .single();

    if (updateError || !updated) {
      req.log?.error?.({ err: updateError }, "plan archive failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit (R13.10)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "archive_plan",
      entity: "plan",
      entityId: planId,
      changes: {
        prior_archived: false,
        new_archived: true,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({ data: updated });
  },
);

// ---------------------------------------------------------------------------
// DELETE /platform/plans/:id — delete plan (R13.9, R13.10)
// ---------------------------------------------------------------------------
router.delete(
  "/platform/plans/:id",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const planId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Verify the plan exists
    const { data: plan, error: fetchError } = await cp
      .from("subscription_plans")
      .select("id, name")
      .eq("id", planId)
      .single();

    if (fetchError || !plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    // Guard: count assigned stores (R13.9)
    const { count, error: countError } = await cp
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("subscription_plan_id", planId);

    if (countError) {
      req.log?.error?.({ err: countError }, "failed to count stores for delete guard");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const deleteCheck = canDeletePlan(planId, count ?? 0);
    if (!deleteCheck.success) {
      res.status(deleteCheck.httpStatus).json({ error: deleteCheck.error });
      return;
    }

    // Delete the plan
    const { error: deleteError } = await cp
      .from("subscription_plans")
      .delete()
      .eq("id", planId);

    if (deleteError) {
      req.log?.error?.({ err: deleteError }, "plan deletion failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit (R13.10)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "delete_plan",
      entity: "plan",
      entityId: planId,
      changes: {
        name: plan.name,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(204).end();
  },
);

export default router;
