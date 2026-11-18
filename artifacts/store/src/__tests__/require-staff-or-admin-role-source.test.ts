import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Role authority comes from public.users.role only; auth metadata is user-writable.
// Lives in the store unit project so it runs under `pnpm test:unit` (no database, no env).
const state = vi.hoisted(() => ({
  profile: null as { role: string | null } | null,
  user: { id: "u1", email: "u@example.com", app_metadata: { role: "admin" }, user_metadata: { role: "admin" } },
}));

vi.mock("../../../api-server/src/lib/supabase", () => ({
  getSupabase: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => {
          const result = { data: state.profile };
          return { single: async () => result, maybeSingle: async () => result };
        },
      }),
    }),
  }),
}));

async function run() {
  const { requireStaffOrAdmin } = await import("../../../api-server/src/middlewares/requireStaffOrAdmin");
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const req = { headers: { authorization: "Bearer t" } };
  const next = vi.fn();
  await requireStaffOrAdmin(req as unknown as Request, res as unknown as Response, next as unknown as NextFunction);
  return { res, next };
}

describe("requireStaffOrAdmin role source", () => {
  beforeEach(() => {
    state.profile = null;
  });

  it("403 when metadata says admin but there is no profile row", async () => {
    const { res, next } = await run();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 when the profile row has a null role", async () => {
    state.profile = { role: null };
    const { res, next } = await run();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes when the profile row role is admin", async () => {
    state.profile = { role: "admin" };
    const { res, next } = await run();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
