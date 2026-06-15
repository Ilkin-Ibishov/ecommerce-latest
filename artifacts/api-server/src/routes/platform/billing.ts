/**
 * Billing routes — invoice listing, manual pay, and scheduler run.
 *
 * Feature: super-admin-platform
 * Requirements: 6.10, 14.8, 14.9, 14.11, 14.12
 *
 * Routes:
 *  GET  /platform/stores/:id/invoices    — list invoices for a store (requireSuperAdmin)
 *  POST /platform/invoices/:id/pay       — manually mark invoice paid (requireSuperAdmin)
 *  POST /platform/billing/run            — idempotent billing cycle (requireServiceCredential)
 */
import { Router, type IRouter } from "express";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { requireServiceCredential } from "../../middlewares/requireServiceCredential";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { applyBillingEvent, type BillingState } from "../../lib/billing/transition";
import { runBillingCycle } from "../../lib/billing/scheduler";
import { writePlatformAudit } from "../../lib/platform/audit";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /platform/stores/:id/invoices — list invoices for a store (R6.10)
// ---------------------------------------------------------------------------
router.get(
  "/platform/stores/:id/invoices",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Verify the store exists
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .single();

    if (storeError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Fetch invoices ordered by period_start descending
    const { data: invoices, error: invoicesError } = await cp
      .from("invoices")
      .select("*")
      .eq("store_id", storeId)
      .order("period_start", { ascending: false });

    if (invoicesError) {
      req.log?.error?.({ err: invoicesError }, "failed to list invoices");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.json({ data: invoices ?? [] });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/invoices/:id/pay — mark invoice as paid (R6.10, R14.9)
// ---------------------------------------------------------------------------
router.post(
  "/platform/invoices/:id/pay",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const invoiceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();
    const now = new Date().toISOString();

    // Fetch the invoice
    const { data: invoice, error: fetchError } = await cp
      .from("invoices")
      .select("id, store_id, status, amount, period_start, period_end")
      .eq("id", invoiceId)
      .single();

    if (fetchError || !invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // Only open invoices can be marked as paid
    if (invoice.status !== "open") {
      res.status(409).json({ error: `Invoice is already ${invoice.status}` });
      return;
    }

    // Update invoice status to paid
    const { error: updateError } = await cp
      .from("invoices")
      .update({ status: "paid", paid_at: now })
      .eq("id", invoiceId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "failed to update invoice status");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Fetch the store's current state for billing transition
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id, subscription_status, platform_status")
      .eq("id", invoice.store_id)
      .single();

    if (storeError || !store) {
      // Invoice is paid but we can't apply transitions — log and return success
      req.log?.error?.({ err: storeError }, "failed to fetch store for billing transition");
      res.json({ data: { id: invoiceId, status: "paid", paid_at: now } });
      return;
    }

    // Check if there's an active grace period for this store
    const { data: activeGrace } = await cp
      .from("grace_periods")
      .select("id")
      .eq("store_id", invoice.store_id)
      .eq("resolved", false)
      .limit(1);

    const gracePeriodActive = (activeGrace && activeGrace.length > 0) || false;

    // Apply payment_recorded transition
    const currentState: BillingState = {
      subscriptionStatus: store.subscription_status as BillingState["subscriptionStatus"],
      platformStatus: store.platform_status as BillingState["platformStatus"],
      gracePeriodActive,
    };

    const transition = applyBillingEvent(currentState, {
      type: "payment_recorded",
      invoiceId,
    });

    if (transition) {
      // Apply the transition to the store
      type PlatformStatus = "onboarding" | "active" | "suspended" | "disabled";
      type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled";

      const storeUpdate: {
        subscription_status?: SubscriptionStatus;
        platform_status?: PlatformStatus;
        suspended_at?: string | null;
        status_before_suspend?: string | null;
      } = {
        subscription_status: transition.newSubscriptionStatus as SubscriptionStatus,
        platform_status: transition.newPlatformStatus as PlatformStatus,
      };

      // If reactivating from suspension, clear suspended_at
      if (
        currentState.platformStatus === "suspended" &&
        transition.newPlatformStatus === "active"
      ) {
        storeUpdate.suspended_at = null;
        storeUpdate.status_before_suspend = null;
      }

      const { error: storeUpdateError } = await cp
        .from("stores")
        .update(storeUpdate)
        .eq("id", invoice.store_id);

      if (storeUpdateError) {
        req.log?.error?.({ err: storeUpdateError }, "failed to apply billing transition to store");
        // Still return success for the invoice payment itself
      }

      // Resolve any active grace periods for this store
      if (transition.endGracePeriod) {
        await cp
          .from("grace_periods")
          .update({ resolved: true })
          .eq("store_id", invoice.store_id)
          .eq("resolved", false);
      }

      // Audit the manual payment transition (R14.9)
      writePlatformAudit({
        actorId: req.superAdmin!.userId,
        action: "payment_recorded",
        entity: "invoice",
        entityId: invoiceId,
        storeId: invoice.store_id,
        changes: {
          prior_subscription_status: currentState.subscriptionStatus,
          new_subscription_status: transition.newSubscriptionStatus,
          prior_platform_status: currentState.platformStatus,
          new_platform_status: transition.newPlatformStatus,
          amount: Number(invoice.amount),
          timestamp: now,
        },
      });
    } else {
      // No transition needed, just audit the payment (R14.9)
      writePlatformAudit({
        actorId: req.superAdmin!.userId,
        action: "payment_recorded",
        entity: "invoice",
        entityId: invoiceId,
        storeId: invoice.store_id,
        changes: {
          amount: Number(invoice.amount),
          timestamp: now,
        },
      });
    }

    res.json({ data: { id: invoiceId, status: "paid", paid_at: now } });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/billing/run — idempotent billing cycle (R14.8, R14.11, R14.12)
// ---------------------------------------------------------------------------
router.post(
  "/platform/billing/run",
  requireServiceCredential,
  async (req, res): Promise<void> => {
    try {
      const result = await runBillingCycle();
      res.json({ data: result });
    } catch (err) {
      req.log?.error?.({ err }, "billing run failed");
      res.status(500).json({ error: "Billing run failed" });
    }
  },
);

export default router;
