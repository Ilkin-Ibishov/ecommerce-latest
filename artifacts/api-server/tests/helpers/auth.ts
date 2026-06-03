/**
 * Auth test helper — provides OTP-based login for integration tests.
 *
 * Uses the dev-only `/api/dev/mock-otp` endpoint to inject an OTP code,
 * then verifies it via `/api/auth/otp/verify` to obtain session tokens.
 */

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  phone: string;
}

/**
 * Authenticate a test user via the dev OTP flow.
 *
 * 1. Calls `/api/dev/mock-otp` to inject an OTP for the given phone.
 * 2. Calls `/api/auth/otp/verify` with the phone + code to get a session.
 * 3. Extracts the userId from the JWT access token payload.
 *
 * @param baseUrl - The API server base URL (e.g. `http://localhost:5000`)
 * @param phone - An Azerbaijani phone number (e.g. `+994501234001`)
 */
export async function loginTestUser(
  baseUrl: string,
  phone: string
): Promise<AuthSession> {
  // 1. Inject OTP via dev endpoint
  const mockRes = await fetch(`${baseUrl}/api/dev/mock-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });

  if (!mockRes.ok) {
    const err = await mockRes.json().catch(() => ({ error: mockRes.statusText }));
    throw new Error(
      `[loginTestUser] mock-otp failed (${mockRes.status}): ${err.error ?? JSON.stringify(err)}`
    );
  }

  const { code } = (await mockRes.json()) as { code: string };

  // 2. Verify OTP to get session tokens
  const verifyRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({ error: verifyRes.statusText }));
    throw new Error(
      `[loginTestUser] otp/verify failed (${verifyRes.status}): ${err.error ?? JSON.stringify(err)}`
    );
  }

  const session = (await verifyRes.json()) as {
    success: boolean;
    access_token: string;
    refresh_token: string;
  };

  // 3. Extract userId from JWT payload (Supabase JWTs use `sub` for user ID)
  const userId = extractUserIdFromJwt(session.access_token);

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId,
    phone,
  };
}

/**
 * Decode the `sub` claim from a Supabase JWT access token.
 * JWTs are base64url-encoded and the payload is the second segment.
 */
function extractUserIdFromJwt(token: string): string {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return "";

    // Convert base64url to standard base64
    const base64 = payloadSegment
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const payload = JSON.parse(atob(base64)) as { sub?: string };
    return payload.sub ?? "";
  } catch {
    return "";
  }
}
