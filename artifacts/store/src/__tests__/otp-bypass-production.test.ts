import { describe, it, expect, vi, afterEach } from "vitest";

// The fixed test code must not log anyone in when NODE_ENV is production.
// The DB lookup is mocked to "no OTP row", so only the bypass could say valid.
vi.mock("../../../../artifacts/api-server/src/lib/supabase", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gt", "gte", "order"]) q[m] = () => q;
  q.limit = async () => ({ data: [], error: null });
  return { getAdminSupabase: () => ({ from: () => q }) };
});

const original = process.env.NODE_ENV;

async function loadOtp(env: string) {
  process.env.NODE_ENV = env;
  vi.resetModules();
  return import("../../../../artifacts/api-server/src/lib/otp");
}

afterEach(() => {
  process.env.NODE_ENV = original;
});

describe("OTP test bypass", () => {
  it("is rejected in production", async () => {
    const { verifyOTP } = await loadOtp("production");
    expect(await verifyOTP("+994550000001", "999999")).toEqual({
      valid: false,
      reason: "not_found_or_expired",
    });
  });

  it("still works outside production", async () => {
    const { verifyOTP } = await loadOtp("development");
    expect(await verifyOTP("+994550000001", "999999")).toEqual({ valid: true });
  });
});
