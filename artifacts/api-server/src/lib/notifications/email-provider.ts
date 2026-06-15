/**
 * Pluggable email provider adapter for notification delivery.
 *
 * Feature: super-admin-platform
 * Requirements: 18.1, 18.2, 18.5, 18.6, 18.10
 *
 * The Control_Plane uses this adapter to send email notifications to store
 * owners. The adapter is swappable and mockable — production implementations
 * can plug in any transactional email service (SendGrid, SES, Postmark, etc.).
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Pluggable email delivery adapter.
 *
 * Implementations MUST:
 * - Return `{ success: true }` on successful delivery acceptance by the provider.
 * - Return `{ success: false, error: "..." }` on any failure (network, auth, bounce, etc.).
 * - Never throw — all errors are captured in the return value.
 */
export interface EmailProvider {
  send(
    to: string,
    subject: string,
    htmlBody: string,
  ): Promise<{ success: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// NoOpEmailProvider — stub for testing and development
// ---------------------------------------------------------------------------

/**
 * A no-op email provider that always succeeds without sending anything.
 * Use this in development, testing, or when email delivery is not configured.
 */
export class NoOpEmailProvider implements EmailProvider {
  async send(
    _to: string,
    _subject: string,
    _htmlBody: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor — allows runtime swap via `setEmailProvider()`
// ---------------------------------------------------------------------------

let currentProvider: EmailProvider = new NoOpEmailProvider();

/**
 * Returns the currently configured email provider instance.
 */
export function getEmailProvider(): EmailProvider {
  return currentProvider;
}

/**
 * Replaces the current email provider (e.g. at application startup once
 * the provider config is loaded from env, or in tests to inject a mock).
 */
export function setEmailProvider(provider: EmailProvider): void {
  currentProvider = provider;
}
