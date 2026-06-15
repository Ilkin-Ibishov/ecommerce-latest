/**
 * Billing scheduler — idempotent/convergent billing-cycle runner.
 *
 * Feature: super-admin-platform
 * Requirements: 6.10, 14.8, 14.9, 14.11, 14.12
 *
 * Called by `POST /platform/billing/run` (requireServiceCredential).
 * Iterates all stores with a subscription_plan_id set, generates invoices,
 * applies billing transitions for past-due and expired grace periods.
 * Failures are isolated per Store and re-attempted on the next run.
 * Automated transitions are audited with a system-actor marker.
 */
import { getControlPlaneSupabase } from "../control-plane-supabase";
import { computeNextInvoice } from "./generate";
import { applyBillingEvent, type BillingState } from "./transition";
import { writePlatformAudit } from "../platform/audit";
import { logger } from "../logger";

export interface BillingRunResult {
  processed: number;
  invoicesGenerated: number;
  transitionsApplied: number;
  failures: number;
  retentionPurges: number;
}

/**
 * Run a single idempotent billing cycle across all eligible stores.
 *
 * Logic:
 * 1. Fetch billing_config (trial_days, due_days, grace_period_days)
 * 2. Iterate all stores with subscription_plan_id set
 * 3. For each store: generate invoices if needed, check past-due, check expired grace
 * 4. Failures isolated per store (catch + continue + re-attempt next run)
 * 5. Audit each automated transition with system-actor marker
 */
export async function runBillingCycle(): Promise<BillingRunResult> {
  const cp = getControlPlaneSupabase();
  const now = new Date().toISOString();
  const nowDate = now.slice(0, 10); // YYYY-MM-DD

  const result: BillingRunResult = {
    processed: 0,
    invoicesGenerated: 0,
    transitionsApplied: 0,
    failures: 0,
    retentionPurges: 0,
  };

  // 1. Fetch billing config
  const { data: configRow, error: configError } = await cp
    .from("billing_config")
    .select("trial_days, due_days, grace_period_days")
    .eq("id", 1)
    .single();

  if (configError || !configRow) {
    logger.error({ err: configError }, "billing scheduler: failed to fetch billing_config");
    throw new Error("Failed to fetch billing_config");
  }

  const { trial_days, due_days, grace_period_days: defaultGraceDays } = configRow;

  // 2. Fetch all stores with a subscription plan assigned
  const { data: stores, error: storesError } = await cp
    .from("stores")
    .select("id, created_at, subscription_plan_id, subscription_status, platform_status, billing_anchor, grace_period_days")
    .not("subscription_plan_id", "is", null);

  if (storesError) {
    logger.error({ err: storesError }, "billing scheduler: failed to fetch stores");
    throw new Error("Failed to fetch stores");
  }

  if (!stores || stores.length === 0) {
    return result;
  }

  // 3. Process each store
  for (const store of stores) {
    try {
      result.processed++;
      await processStore(cp, store, {
        trialDays: trial_days,
        dueDays: due_days,
        defaultGraceDays,
        now,
        nowDate,
      }, result);
    } catch (err) {
      // Failure isolated per store (R14.11, R14.12)
      result.failures++;
      logger.error(
        { err, storeId: store.id },
        "billing scheduler: store processing failed",
      );

      // Audit the failure with system-actor marker (R14.11, R14.12)
      writePlatformAudit({
        action: "billing_run_failure",
        entity: "store",
        entityId: store.id,
        storeId: store.id,
        changes: {
          actor: "system",
          error: err instanceof Error ? err.message : String(err),
          timestamp: now,
        },
      });
    }
  }

  // 4. Retention purge sweep (R16.4) — purge expired offboarding records within 24h
  try {
    const purgesCompleted = await runRetentionPurgeSweep(cp, now);
    result.retentionPurges = purgesCompleted;
  } catch (err) {
    logger.error({ err }, "billing scheduler: retention purge sweep failed");
    // Isolated failure — billing run still succeeds
  }

  return result;
}

/**
 * Sweep expired retention records and purge their Control_Plane data.
 * R16.4: retention end triggers purge within 24h — enforced by running
 * in the scheduler alongside billing.
 */
async function runRetentionPurgeSweep(
  cp: ReturnType<typeof getControlPlaneSupabase>,
  now: string,
): Promise<number> {
  // Find offboarding records where retention has expired but not yet purged
  const { data: expiredRecords, error: fetchError } = await cp
    .from("store_offboarding")
    .select("store_id, retention_ends_at")
    .eq("purged", false)
    .lt("retention_ends_at", now);

  if (fetchError || !expiredRecords || expiredRecords.length === 0) {
    return 0;
  }

  let purged = 0;

  for (const record of expiredRecords) {
    try {
      // Check that the purge deadline (retention_ends_at + 24h) hasn't been
      // exceeded without action — still proceed either way to enforce.
      // Delete Control_Plane records for this store (children first)
      await cp.from("platform_notification_reads").delete().eq("store_id", record.store_id);
      await cp.from("platform_notification_targets").delete().eq("store_id", record.store_id);
      await cp.from("grace_periods").delete().eq("store_id", record.store_id);
      await cp.from("invoices").delete().eq("store_id", record.store_id);
      await cp.from("store_metrics_cache").delete().eq("store_id", record.store_id);

      // Mark as purged with teardown
      await cp
        .from("store_offboarding")
        .update({
          purged: true,
          purged_at: now,
          teardown_recorded: true,
          teardown_at: now,
        })
        .eq("store_id", record.store_id);

      purged++;

      // Audit the automated purge with system-actor marker
      writePlatformAudit({
        action: "offboard_purge_automated",
        entity: "store",
        entityId: record.store_id,
        storeId: record.store_id,
        changes: {
          actor: "system",
          retention_ends_at: record.retention_ends_at,
          purged_at: now,
          teardown_recorded: true,
          timestamp: now,
        },
      });
    } catch (err) {
      logger.error(
        { err, storeId: record.store_id },
        "retention purge sweep: store purge failed",
      );
      // Continue processing other stores
    }
  }

  return purged;
}

interface ProcessConfig {
  trialDays: number;
  dueDays: number;
  defaultGraceDays: number;
  now: string;
  nowDate: string;
}

async function processStore(
  cp: ReturnType<typeof getControlPlaneSupabase>,
  store: {
    id: string;
    created_at: string;
    subscription_plan_id: string | null;
    subscription_status: string;
    platform_status: string;
    billing_anchor: string | null;
    grace_period_days: number | null;
  },
  config: ProcessConfig,
  result: BillingRunResult,
): Promise<void> {
  const { trialDays, dueDays, defaultGraceDays, now, nowDate } = config;

  if (!store.subscription_plan_id) return;

  // Fetch plan price for invoice generation
  const { data: plan, error: planError } = await cp
    .from("subscription_plans")
    .select("price, billing_interval")
    .eq("id", store.subscription_plan_id)
    .single();

  if (planError || !plan) {
    throw new Error(`Failed to fetch plan ${store.subscription_plan_id}`);
  }

  // Fetch existing invoice periods for this store
  const { data: existingInvoices, error: invoicesError } = await cp
    .from("invoices")
    .select("period_start, period_end")
    .eq("store_id", store.id);

  if (invoicesError) {
    throw new Error("Failed to fetch existing invoices");
  }

  // --- Invoice generation ---
  const genResult = computeNextInvoice({
    storeCreatedAt: store.created_at.slice(0, 10),
    trialDays,
    billingAnchor: store.billing_anchor,
    billingInterval: plan.billing_interval as "monthly" | "yearly",
    dueDays,
    planPrice: Number(plan.price),
    existingInvoicePeriods: (existingInvoices ?? []).map((inv) => ({
      period_start: String(inv.period_start),
      period_end: String(inv.period_end),
    })),
    now: nowDate,
  });

  if (genResult.generate) {
    const inv = genResult.invoice;

    // Insert invoice (idempotent — unique constraint on (store_id, period_start, period_end))
    const { error: insertError } = await cp
      .from("invoices")
      .insert({
        store_id: store.id,
        plan_id: store.subscription_plan_id,
        period_start: inv.period_start,
        period_end: inv.period_end,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        amount: inv.amount,
        status: "open",
      });

    if (insertError) {
      // If it's a unique constraint violation, it's idempotent — already generated
      if (insertError.code === "23505") {
        // Already exists, skip
      } else {
        throw new Error(`Invoice insert failed: ${insertError.message}`);
      }
    } else {
      result.invoicesGenerated++;

      // Set billing_anchor if not already set
      if (!store.billing_anchor) {
        await cp
          .from("stores")
          .update({ billing_anchor: inv.billing_anchor })
          .eq("id", store.id);
      }

      // Audit invoice generation (system actor)
      writePlatformAudit({
        action: "invoice_generated",
        entity: "invoice",
        storeId: store.id,
        changes: {
          actor: "system",
          period_start: inv.period_start,
          period_end: inv.period_end,
          amount: inv.amount,
          due_date: inv.due_date,
          timestamp: now,
        },
      });
    }
  }

  // --- Check past-due invoices (unpaid past due_date) ---
  const { data: pastDueInvoices, error: pastDueError } = await cp
    .from("invoices")
    .select("id, due_date, store_id")
    .eq("store_id", store.id)
    .eq("status", "open")
    .lt("due_date", nowDate);

  if (pastDueError) {
    throw new Error("Failed to fetch past-due invoices");
  }

  for (const invoice of pastDueInvoices ?? []) {
    // Apply invoice_due_passed transition
    const currentState: BillingState = {
      subscriptionStatus: store.subscription_status as BillingState["subscriptionStatus"],
      platformStatus: store.platform_status as BillingState["platformStatus"],
      gracePeriodActive: false, // will check below
    };

    const transition = applyBillingEvent(currentState, {
      type: "invoice_due_passed",
      invoiceId: invoice.id,
    });

    if (transition) {
      // Update store subscription_status
      const { error: updateError } = await cp
        .from("stores")
        .update({
          subscription_status: transition.newSubscriptionStatus as "trialing" | "active" | "past_due" | "cancelled",
        })
        .eq("id", store.id);

      if (updateError) {
        // R14.12: failure isolated, audit and continue
        writePlatformAudit({
          action: "billing_transition_failure",
          entity: "store",
          entityId: store.id,
          storeId: store.id,
          changes: {
            actor: "system",
            event: "invoice_due_passed",
            invoice_id: invoice.id,
            error: updateError.message,
            timestamp: now,
          },
        });
        continue;
      }

      result.transitionsApplied++;

      // Start a grace period
      const effectiveGraceDays = store.grace_period_days ?? defaultGraceDays;
      const gracEndsAt = new Date(invoice.due_date + "T00:00:00Z");
      gracEndsAt.setUTCDate(gracEndsAt.getUTCDate() + effectiveGraceDays);

      await cp.from("grace_periods").insert({
        store_id: store.id,
        invoice_id: invoice.id,
        started_at: invoice.due_date + "T00:00:00Z",
        ends_at: gracEndsAt.toISOString(),
      });

      // Update local state for subsequent checks in this iteration
      store.subscription_status = transition.newSubscriptionStatus;

      // Audit automated transition (R14.8)
      writePlatformAudit({
        action: "billing_transition",
        entity: "store",
        entityId: store.id,
        storeId: store.id,
        changes: {
          actor: "system",
          event: "invoice_due_passed",
          invoice_id: invoice.id,
          prior_subscription_status: currentState.subscriptionStatus,
          new_subscription_status: transition.newSubscriptionStatus,
          timestamp: now,
        },
      });
    }
  }

  // --- Check expired grace periods ---
  const { data: expiredGracePeriods, error: graceError } = await cp
    .from("grace_periods")
    .select("id, invoice_id, ends_at")
    .eq("store_id", store.id)
    .eq("resolved", false)
    .lt("ends_at", now);

  if (graceError) {
    throw new Error("Failed to fetch expired grace periods");
  }

  for (const gp of expiredGracePeriods ?? []) {
    const currentState: BillingState = {
      subscriptionStatus: store.subscription_status as BillingState["subscriptionStatus"],
      platformStatus: store.platform_status as BillingState["platformStatus"],
      gracePeriodActive: true,
    };

    const transition = applyBillingEvent(currentState, {
      type: "grace_period_ended",
      invoiceId: gp.invoice_id,
    });

    if (transition) {
      // Update store platform_status
      const { error: updateError } = await cp
        .from("stores")
        .update({
          platform_status: transition.newPlatformStatus as "onboarding" | "active" | "suspended" | "disabled",
          ...(transition.newPlatformStatus === "suspended"
            ? { suspended_at: now, status_before_suspend: store.platform_status }
            : {}),
        })
        .eq("id", store.id);

      if (updateError) {
        // R14.12: failure isolated, audit and continue
        writePlatformAudit({
          action: "billing_transition_failure",
          entity: "store",
          entityId: store.id,
          storeId: store.id,
          changes: {
            actor: "system",
            event: "grace_period_ended",
            invoice_id: gp.invoice_id,
            error: updateError.message,
            timestamp: now,
          },
        });
        continue;
      }

      result.transitionsApplied++;

      // Mark grace period as resolved
      await cp
        .from("grace_periods")
        .update({ resolved: true })
        .eq("id", gp.id);

      // Update local state
      store.platform_status = transition.newPlatformStatus;

      // Audit automated transition (R14.8)
      writePlatformAudit({
        action: "billing_transition",
        entity: "store",
        entityId: store.id,
        storeId: store.id,
        changes: {
          actor: "system",
          event: "grace_period_ended",
          invoice_id: gp.invoice_id,
          prior_platform_status: currentState.platformStatus,
          new_platform_status: transition.newPlatformStatus,
          timestamp: now,
        },
      });
    }
  }
}
