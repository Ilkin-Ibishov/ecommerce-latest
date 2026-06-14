import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mock the Supabase lib that both middlewares depend on.
// - requireAdmin.ts imports `requireAdmin as resolveAdmin` from ../lib/supabase
// - requireUser.ts imports `getSupabase` from ../lib/supabase
// The mock path resolves to the same module the middleware sources import.
vi.mock("../src/lib/supabase", () => ({
  requireAdmin: vi.fn(),
  getSupabase: vi.fn(),
}));

import * as supabaseLib from "../src/lib/supabase";
import { requireAdmin } from "../src/middlewares/requireAdmin";
import { requireUser } from "../src/middlewares/requireUser";

// Reference to the mocked lib `requireAdmin` (aliased `resolveAdmin` inside the
// middleware) and the mocked `getSupabase` factory.
const mockedResolveAdmin = vi.mocked(supabaseLib.requireAdmin);
const mockedGetSupabase = vi.mocked(supabaseLib.getSupabase);

// --- Fake req/res/next factories -------------------------------------------

interface FakeRes extends Response {
  statusCode?: number;
  body?: unknown;
}

function createReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function createRes(): FakeRes {
  const res = {} as FakeRes;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response["json"];
  return res;
}

function createNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdmin middleware (R3.7)", () => {
  it("valid admin credential: attaches req.user + req.admin and calls next()", async () => {
    const fakeUser = { id: "admin-1", role: "admin" };
    const fakeAdminClient = { from: vi.fn() };
    mockedResolveAdmin.mockResolvedValueOnce({ user: fakeUser, admin: fakeAdminClient });

    const req = createReq({ authorization: "Bearer valid-admin-token" });
    const res = createRes();
    const next = createNext();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(fakeUser);
    expect(req.admin).toBe(fakeAdminClient);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("invalid credential (non-admin token): responds 403 { error: 'Forbidden' } and does not call next()", async () => {
    // resolveAdmin returns null when the token does not resolve to an admin.
    mockedResolveAdmin.mockResolvedValueOnce(null);

    const req = createReq({ authorization: "Bearer not-an-admin-token" });
    const res = createRes();
    const next = createNext();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("missing credential (no Authorization header): responds 403 { error: 'Forbidden' } and does not call next()", async () => {
    // With no token, the underlying admin resolution yields null.
    mockedResolveAdmin.mockResolvedValueOnce(null);

    const req = createReq({});
    const res = createRes();
    const next = createNext();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireUser middleware (R3.7)", () => {
  function mockGetUser(user: unknown) {
    mockedGetSupabase.mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user } }),
      },
    } as unknown as ReturnType<typeof supabaseLib.getSupabase>);
  }

  it("valid user token: attaches req.authUser = { id } and calls next()", async () => {
    mockGetUser({ id: "user-42" });

    const req = createReq({ authorization: "Bearer valid-user-token" });
    const res = createRes();
    const next = createNext();

    await requireUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.authUser).toEqual({ id: "user-42" });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("invalid/expired token (no user resolved): responds 401 { error: 'Unauthorized' } and does not call next()", async () => {
    mockGetUser(null);

    const req = createReq({ authorization: "Bearer expired-or-bad-token" });
    const res = createRes();
    const next = createNext();

    await requireUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("missing credential (no Authorization header): responds 401 { error: 'Unauthorized' } and does not call next()", async () => {
    const req = createReq({});
    const res = createRes();
    const next = createNext();

    await requireUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
    // Short-circuits before touching Supabase auth.
    expect(mockedGetSupabase).not.toHaveBeenCalled();
  });
});
