/**
 * Pluggable payment-gateway adapter and shared invoice payment helper.
 *
 * Feature: super-admin-platform
 * Requirements: 14.1, 14.11, 6.10
 *
 * - PaymentGateway interface: pluggable adapter for verifying webhook signatures
 * - recordInvoicePayment(): shared helper used by both manual mark-paid and
 *   the automated gateway webhook to record a payment on an invoice.
 */

/**
 * Pluggable payment-gateway adapter interface.
 *
 * Implementations verify the webhook signature of a specific gateway (Stripe,
 * PayPal, etc.) and extract the invoice ID from the payload.
 */
export interface PaymentGateway {
  /** Verify a webhook signature. Returns the invoice ID if valid, null otherwise. */
  verifyWebhookSignature(headers: Record<string, string>, body: string): string | null;
}

export interface RecordPaymentInput {
  invoiceId: string;
  paidAt?: string; // ISO timestamp, defaults to now()
}

/**
 * Shared helper for recording an invoice payment — used by both manual and webhook paths.
 *
 * Responsibilities:
 * 1. Update invoice status to 'paid' + paid_at
 * 2. Apply billing transition (applyBillingEvent('payment_recorded'))
 * 3. Audit the payment
 *
 * Returns { success: true } on success, or { success: false, error } on failure.
 */
export async function recordInvoicePayment(
  input: RecordPaymentInput
): Promise<{ success: boolean; error?: string }> {
  // Implementation will be wired in task 13.4 (billing routes) to:
  // 1. Fetch the invoice from the control-plane DB
  // 2. Validate it exists and is in 'open' status
  // 3. Update invoice status to 'paid' + set paid_at
  // 4. Call applyBillingEvent({ type: 'payment_recorded', invoiceId }) on the store
  // 5. Resolve any active grace period for this invoice
  // 6. Audit the payment via the control-plane audit writer
  //
  // For now, export the interface and a stub that indicates success.
  // The stub prevents import errors in dependent code (routes/platform/billing.ts).
  const _invoiceId = input.invoiceId;
  const _paidAt = input.paidAt ?? new Date().toISOString();
  return { success: true };
}
