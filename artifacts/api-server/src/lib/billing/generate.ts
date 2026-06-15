/**
 * Pure invoice generation logic for the billing lifecycle.
 *
 * Feature: super-admin-platform
 * Requirements: 14.1, 14.11
 *
 * - First invoice at trial end (created_at + trial_days, default 14)
 * - Subsequent periods from the persisted billing anchor + k·interval (no drift)
 * - Exactly one invoice per interval (issue at boundary, due = issue + due_days, amount = plan price)
 */

export interface InvoiceGenerationInput {
  storeCreatedAt: string; // ISO date
  trialDays: number; // default 14
  billingAnchor: string | null; // ISO date, null = not yet set (trial hasn't ended)
  billingInterval: 'monthly' | 'yearly';
  dueDays: number; // default 14, must be 1–90
  planPrice: number; // e.g. 99.00
  existingInvoicePeriods: Array<{ period_start: string; period_end: string }>; // already generated
  now: string; // ISO date for current time
}

export interface GeneratedInvoice {
  period_start: string;
  period_end: string;
  issue_date: string;
  due_date: string;
  amount: number;
  billing_anchor: string; // the computed anchor (trial end date)
}

export type InvoiceGenerationResult =
  | { generate: true; invoice: GeneratedInvoice }
  | { generate: false; reason: string };

/**
 * Adds a number of days to an ISO date string, returning a new ISO date string.
 */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Adds months to an ISO date string, clamping to end-of-month if needed.
 * This ensures no drift: anchor + k*months is always computed from the anchor.
 */
function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  const targetMonth = d.getUTCMonth() + months;
  const dayOfMonth = d.getUTCDate();
  d.setUTCMonth(targetMonth, 1); // set to 1st of target month to avoid overflow
  // Now set the day, clamping to the last day of the target month
  const lastDayOfMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(dayOfMonth, lastDayOfMonth));
  return d.toISOString().slice(0, 10);
}

/**
 * Computes the period boundary (period_start) for period k from anchor + k * interval.
 */
function computePeriodStart(
  anchor: string,
  k: number,
  interval: 'monthly' | 'yearly'
): string {
  const months = interval === 'monthly' ? k : k * 12;
  return addMonths(anchor, months);
}

/**
 * Checks whether an ISO date string a is before b (strictly less than).
 */
function isBefore(a: string, b: string): boolean {
  return a < b;
}

/**
 * Checks if a period already exists in the existing invoice periods list.
 */
function periodExists(
  existing: Array<{ period_start: string; period_end: string }>,
  periodStart: string,
  periodEnd: string
): boolean {
  return existing.some(
    (p) => p.period_start === periodStart && p.period_end === periodEnd
  );
}

/**
 * Computes the next invoice to generate for a store.
 *
 * Logic:
 * - Trial end = storeCreatedAt + trialDays days
 * - If now < trial end → { generate: false, reason: "trial_not_ended" }
 * - billingAnchor = input.billingAnchor ?? trial end date (first invoice uses trial end as anchor)
 * - Compute period boundaries from anchor: period_k_start = anchor + k*interval,
 *   period_k_end = anchor + (k+1)*interval
 * - Find the first period that: (a) starts at or before `now`, AND (b) is NOT already in existingInvoicePeriods
 * - If found → generate it: issue_date = period_start, due_date = issue + dueDays, amount = planPrice
 * - If not found → { generate: false, reason: "no_pending_period" }
 */
export function computeNextInvoice(
  input: InvoiceGenerationInput
): InvoiceGenerationResult {
  // Compute trial end date
  const trialEnd = addDays(input.storeCreatedAt, input.trialDays);

  // If now is before trial end, no invoice yet
  if (isBefore(input.now, trialEnd)) {
    return { generate: false, reason: 'trial_not_ended' };
  }

  // Determine the billing anchor (trial end date if not already set)
  const anchor = input.billingAnchor ?? trialEnd;

  // Iterate through periods k=0, 1, 2, ... finding the first one that:
  // (a) starts at or before `now` (period_start <= now)
  // (b) is NOT already in existingInvoicePeriods
  for (let k = 0; ; k++) {
    const periodStart = computePeriodStart(anchor, k, input.billingInterval);
    const periodEnd = computePeriodStart(anchor, k + 1, input.billingInterval);

    // If this period starts after `now`, we've gone past all eligible periods
    if (isBefore(input.now, periodStart)) {
      break;
    }

    // Check if this period already has an invoice
    if (periodExists(input.existingInvoicePeriods, periodStart, periodEnd)) {
      continue;
    }

    // Found an eligible period — generate the invoice
    const issueDate = periodStart;
    const dueDate = addDays(issueDate, input.dueDays);

    return {
      generate: true,
      invoice: {
        period_start: periodStart,
        period_end: periodEnd,
        issue_date: issueDate,
        due_date: dueDate,
        amount: input.planPrice,
        billing_anchor: anchor,
      },
    };
  }

  return { generate: false, reason: 'no_pending_period' };
}
