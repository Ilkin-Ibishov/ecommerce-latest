import { describe, it, expect, afterAll } from "vitest";
import { loginTestUser } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const TEST_PHONE = "+994501234001";

describe("Auth Integration Tests", () => {
  let userId: string | undefined;

  afterAll(async () => {
    if (userId) {
      await cleanupTestUser(userId);
    }
  });

  it("should send OTP to a valid Azerbaijani phone number", async () => {
    const res = await fetch(`${BASE_URL}/api/dev/mock-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: TEST_PHONE }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { code: string; phone: string };
    expect(body).toHaveProperty("code");
    expect(body).toHaveProperty("phone", TEST_PHONE);
    expect(body.code).toMatch(/^\d{6}$/);
  });

  it("should return valid session tokens when verifying a correct OTP", async () => {
    const session = await loginTestUser(BASE_URL, TEST_PHONE);

    // Store userId for cleanup
    userId = session.userId;

    expect(session.accessToken).toBeDefined();
    expect(session.accessToken.length).toBeGreaterThan(0);
    expect(session.refreshToken).toBeDefined();
    expect(session.refreshToken.length).toBeGreaterThan(0);
    expect(session.userId).toBeDefined();
    expect(session.userId.length).toBeGreaterThan(0);
    expect(session.phone).toBe(TEST_PHONE);
  });

  it("should return a 400-level error when submitting an invalid OTP", async () => {
    // First, inject a valid OTP so the phone is in the system
    await fetch(`${BASE_URL}/api/dev/mock-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: TEST_PHONE }),
    });

    // Attempt to verify with an incorrect code
    const res = await fetch(`${BASE_URL}/api/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: TEST_PHONE, code: "000000" }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
