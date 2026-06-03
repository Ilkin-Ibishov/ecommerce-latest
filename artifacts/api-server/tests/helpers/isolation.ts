/**
 * Parallel test isolation helpers — generate unique phone numbers and session
 * IDs per test worker to prevent collisions when multiple CI workers run
 * tests concurrently.
 */

/**
 * Generate a unique phone number for a test worker.
 *
 * Format: +99450 + 3-digit worker part + 4-digit random part = 13 chars total.
 * Matches the regex `^\+99450\d{7}$` and passes the OTP verify endpoint's
 * phone validation rules.
 *
 * @param workerId Optional worker identifier. Defaults to process.pid XOR a random value.
 */
export function generatePhone(workerId?: number): string {
  const id = workerId ?? (process.pid ^ Math.floor(Math.random() * 10000));
  const workerPart = String(Math.abs(id) % 1000).padStart(3, "0");
  const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `+99450${workerPart}${randomPart}`;
}

/**
 * Generate a unique session ID for guest cart operations per test worker.
 *
 * Format: `sess_w${id}_${timestamp base36}_${random base36}`
 * Guaranteed to be between 36 and 64 characters.
 *
 * @param workerId Optional worker identifier. Defaults to process.pid XOR a random value.
 */
export function generateSessionId(workerId?: number): string {
  const id = workerId ?? (process.pid ^ Math.floor(Math.random() * 10000));
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 14);
  const base = `sess_w${id}_${timestamp}_${random}`;

  // Ensure minimum 36 chars by padding with additional random base36 characters
  if (base.length < 36) {
    const padding = Math.random().toString(36).slice(2, 2 + (36 - base.length));
    return `${base}${padding}`;
  }

  // Ensure maximum 64 chars by truncating
  return base.slice(0, 64);
}
