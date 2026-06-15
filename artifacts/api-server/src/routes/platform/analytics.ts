/**
 * Platform analytics route — MRR, status counts, new/churned, revenue-by-plan.
 *
 * Feature: super-admin-platform
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.11
 *
 * All analytics are derived only from Control_Plane records (Store_Registry,
 * subscription_plans, audit_log transitions) — never any Store's raw records.
 * Uses `getControlPlaneSupabase()` exclusively.
 */
import { Router, type IRouter } from "express";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { validateTimeRange } from "../../lib/platform/range";
import {
  computeAnalytics,
  type StoreRecord,
  type PlanRecord,
  type StatusTransitionRecord,
} from "../../lib/platform/analytics";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /platform/analytics?from=&to= — Platform-wide analytics
// (R19.1, R19.2, R19.3, R19.4, R19.5, R19.6, R19.7)
// ---------------------------------------------------------------------------
router.get(
  "/platform/analytics",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const cp = getControlPlaneSupabase();

    // Validate time range (invalid → 400)
    const rangeResult = validateTimeRange({
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });

    if (!rangeResult.valid) {
      res.status(400).json({ error: rangeResult.error });
      return;
    }

    const { from, to } = rangeResult;

    // Fetch all stores from the Store_Registry
    const { data: rawStores, error: storesError } = await cp
      .from("stores")
      .select("id, subscription_status, subscription_plan_id, created_at");

    if (storesError) {
      req.log?.error?.({ err: storesError }, "analytics: failed to fetch stores");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Fetch all subscription plans
    const { data: rawPlans, error: plansError } = await cp
      .from("subscription_plans")
      .select("id, name, price, billing_interval");

    if (plansError) {
      req.log?.error?.({ err: plansError }, "analytics: failed to fetch plans");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Fetch subscription-status transitions from audit_log within the period.
    // Look for audit entries where the action indicates a status change and
    // extract new_status from the changes jsonb column.
    const { data: rawTransitions, error: transitionsError } = await cp
      .from("audit_log")
      .select("entity_id, changes, created_at")
      .eq("entity", "store")
      .eq("scope", "platform")
      .gte("created_at", `${from}T00:00:00.000Z`)
      .lte("created_at", `${to}T23:59:59.999Z`)
      .like("action", "%_store");

    if (transitionsError) {
      req.log?.error?.({ err: transitionsError }, "analytics: failed to fetch transitions");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Shape stores into StoreRecord[]
    const stores: StoreRecord[] = (rawStores ?? []).map((s) => ({
      id: s.id,
      subscription_status: s.subscription_status,
      subscription_plan_id: s.subscription_plan_id,
      created_at: s.created_at,
    }));

    // Shape plans into PlanRecord[]
    const plans: PlanRecord[] = (rawPlans ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      billing_interval: p.billing_interval,
    }));

    // Shape transitions — extract new_status from changes jsonb
    const transitions: StatusTransitionRecord[] = [];
    for (const row of rawTransitions ?? []) {
      const changes = row.changes as Record<string, unknown> | null;
      if (changes && typeof changes === "object" && "new_status" in changes) {
        transitions.push({
          store_id: row.entity_id ?? "",
          new_status: String(changes.new_status),
          timestamp: row.created_at,
        });
      }
    }

    // Compute analytics using the pure function
    const result = computeAnalytics({
      stores,
      plans,
      transitions,
      periodFrom: from,
      periodTo: to,
    });

    res.json({
      data: {
        ...result,
        period: { from, to },
      },
    });
  },
);

export default router;
