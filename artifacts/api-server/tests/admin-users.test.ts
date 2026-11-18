import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

interface MockUser {
  id: string;
  phone: string;
  full_name: string | null;
  role: "customer" | "staff" | "admin";
  created_at?: string;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const h = vi.hoisted(() => {
  const state = {
    authRole: "admin" as "admin" | "staff" | "shopper" | "none",
    actingUserId: "admin-actor-id",
    users: new Map<string, MockUser>(),
    authCreated: [] as Array<{ id: string; phone: string; phone_confirm: boolean }>,
    rpcCalls: [] as RpcCall[],
  };

  function reset() {
    state.authRole = "admin";
    state.actingUserId = "admin-actor-id";
    state.users.clear();
    state.authCreated.length = 0;
    state.rpcCalls.length = 0;
    state.users.set("admin-actor-id", {
      id: "admin-actor-id",
      phone: "+994509990001",
      full_name: "Admin",
      role: "admin",
      created_at: new Date().toISOString(),
    });
  }

  return { state, reset };
});

vi.mock("../src/middlewares/requireAdmin", () => ({
  requireAdmin: (req: Request, res: Response, next: NextFunction): void => {
    if (h.state.authRole !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    req.user = { id: h.state.actingUserId };
    req.admin = {
      from: (table: string) => {
        if (table !== "users") return {};
        return {
          select: (_cols?: string, opts?: { count?: string }) => {
            let roleFilter: string | undefined;
            let phoneInFilter: string[] | undefined;
            let idEqFilter: string | undefined;

            const builder = {
              eq: (col: string, val: string) => {
                if (col === "role") roleFilter = val;
                if (col === "id") idEqFilter = val;
                return builder;
              },
              in: (col: string, vals: string[]) => {
                if (col === "phone") phoneInFilter = vals;
                return builder;
              },
              or: (_expr: string) => builder,
              order: (_col: string, _opts?: unknown) => builder,
              range: (start: number, end: number) => {
                let filtered = Array.from(h.state.users.values());
                if (roleFilter) filtered = filtered.filter((u) => u.role === roleFilter);
                const sliced = filtered.slice(start, end + 1);
                return Promise.resolve({
                  data: sliced,
                  count: opts?.count === "exact" ? filtered.length : sliced.length,
                  error: null,
                });
              },
              maybeSingle: () => {
                let u: MockUser | undefined;
                if (idEqFilter) u = h.state.users.get(idEqFilter);
                return Promise.resolve({ data: u ?? null, error: null });
              },
              single: () => {
                let u: MockUser | undefined;
                if (idEqFilter) u = h.state.users.get(idEqFilter);
                return Promise.resolve({ data: u ?? null, error: u ? null : { message: "Not found" } });
              },
              then: (resolve: (val: unknown) => void) => {
                let filtered = Array.from(h.state.users.values());
                if (phoneInFilter) {
                  filtered = filtered.filter((u) => phoneInFilter!.includes(u.phone));
                }
                if (roleFilter) {
                  filtered = filtered.filter((u) => u.role === roleFilter);
                }
                resolve({ data: filtered, count: filtered.length, error: null });
              },
            };
            return builder;
          },
          insert: (payload: { id: string; phone: string; full_name: string | null }) => ({
            select: () => ({
              single: () => {
                const created: MockUser = {
                  id: payload.id,
                  phone: payload.phone,
                  full_name: payload.full_name,
                  role: "customer",
                  created_at: new Date().toISOString(),
                };
                h.state.users.set(payload.id, created);
                return Promise.resolve({ data: created, error: null });
              },
            }),
          }),
        };
      },
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.state.rpcCalls.push({ fn, args });
        if (fn === "set_user_role") {
          const targetId = args.p_user as string;
          const targetRole = args.p_role as "customer" | "staff" | "admin";
          const u = h.state.users.get(targetId);
          if (!u) {
            return Promise.resolve({ data: null, error: { message: "User not found", code: "ST041" } });
          }
          if (u.role === "admin" && targetRole !== "admin") {
            const adminCount = Array.from(h.state.users.values()).filter((x) => x.role === "admin").length;
            if (adminCount <= 1) {
              return Promise.resolve({
                data: null,
                error: { message: "ST040: At least one admin must remain in the store", code: "ST040" },
              });
            }
          }
          const oldRole = u.role;
          u.role = targetRole;
          return Promise.resolve({ data: oldRole, error: null });
        }
        if (fn === "find_auth_user_by_phone") {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      auth: {
        admin: {
          createUser: ({ phone, phone_confirm }: { phone: string; phone_confirm: boolean }) => {
            const id = randomUUID();
            h.state.authCreated.push({ id, phone, phone_confirm });
            return Promise.resolve({ data: { user: { id } }, error: null });
          },
        },
      },
    } as unknown as Request["admin"];
    next();
  },
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const usersRouter = (await import("../src/routes/admin/users")).default;
  const app = express();
  app.use(express.json());
  app.use(usersRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.reset();
});

describe("Admin Users & Staff Management API", () => {
  describe("403 Forbidden for non-admin tokens", () => {
    const roles: Array<"shopper" | "staff"> = ["shopper", "staff"];

    for (const role of roles) {
      it(`denies GET /admin/users for ${role}`, async () => {
        h.state.authRole = role;
        const res = await fetch(`${baseUrl}/admin/users`);
        expect(res.status).toBe(403);
      });

      it(`denies POST /admin/users for ${role}`, async () => {
        h.state.authRole = role;
        const res = await fetch(`${baseUrl}/admin/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: "+994501234567", role: "staff" }),
        });
        expect(res.status).toBe(403);
      });

      it(`denies PATCH /admin/users/:id/role for ${role}`, async () => {
        h.state.authRole = role;
        const targetId = randomUUID();
        const res = await fetch(`${baseUrl}/admin/users/${targetId}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "staff" }),
        });
        expect(res.status).toBe(403);
      });
    }
  });

  describe("Bypass phone reservations", () => {
    const bypassPhones = ["+994550000001", "+994550000002", "+994550000003"];

    for (const phone of bypassPhones) {
      it(`refuses POST /admin/users for bypass phone ${phone}`, async () => {
        const res = await fetch(`${baseUrl}/admin/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, role: "staff" }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("phone_reserved");
      });
    }

    it("refuses PATCH /admin/users/:id/role for target with bypass phone when new role is not customer", async () => {
      const bypassUserId = randomUUID();
      h.state.users.set(bypassUserId, {
        id: bypassUserId,
        phone: "+994550000002",
        full_name: "Staff Bypass",
        role: "staff",
      });

      const res = await fetch(`${baseUrl}/admin/users/${bypassUserId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("phone_reserved");
    });
  });

  describe("Unknown ID handling", () => {
    it("returns 404 for unknown user id and executes no audit line", async () => {
      const unknownId = randomUUID();
      const res = await fetch(`${baseUrl}/admin/users/${unknownId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "staff" }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("not_found");

      const rpcSetRole = h.state.rpcCalls.filter((c) => c.fn === "set_user_role");
      expect(rpcSetRole).toHaveLength(0);
    });
  });

  describe("Staff provisioning and role updates", () => {
    it("creates a new staff user via auth.admin.createUser and set_user_role", async () => {
      const res = await fetch(`${baseUrl}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+994 50 111 22 33", full_name: "Rashad", role: "staff" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { success: boolean; user: MockUser };
      expect(body.success).toBe(true);
      expect(body.user.phone).toBe("+994501112233");
      expect(body.user.role).toBe("staff");

      expect(h.state.authCreated).toHaveLength(1);
      expect(h.state.authCreated[0].phone).toBe("+994501112233");

      const setRoleCall = h.state.rpcCalls.find((c) => c.fn === "set_user_role");
      expect(setRoleCall).toBeDefined();
      expect(setRoleCall?.args.p_role).toBe("staff");
      expect(setRoleCall?.args.p_actor).toBe("admin-actor-id");
    });

    it("promotes an existing customer to staff without re-creating auth user", async () => {
      const custId = randomUUID();
      h.state.users.set(custId, {
        id: custId,
        phone: "+994503334455",
        full_name: "Existing Customer",
        role: "customer",
      });

      const res = await fetch(`${baseUrl}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+994503334455", role: "staff" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; promoted: boolean; user: MockUser };
      expect(body.success).toBe(true);
      expect(body.promoted).toBe(true);
      expect(body.user.role).toBe("staff");

      expect(h.state.authCreated).toHaveLength(0);
      const setRoleCall = h.state.rpcCalls.find((c) => c.fn === "set_user_role");
      expect(setRoleCall?.args.p_user).toBe(custId);
      expect(setRoleCall?.args.p_role).toBe("staff");
    });

    it("refuses duplicate staff or admin creation with 409 already_staff", async () => {
      const staffId = randomUUID();
      h.state.users.set(staffId, {
        id: staffId,
        phone: "+994504445566",
        full_name: "Existing Staff",
        role: "staff",
      });

      const res = await fetch(`${baseUrl}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+994504445566", role: "staff" }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("already_staff");
    });

    it("prevents self-demotion on PATCH /admin/users/:id/role", async () => {
      const res = await fetch(`${baseUrl}/admin/users/admin-actor-id/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "staff" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("cannot_demote_self");
      expect(h.state.users.get("admin-actor-id")?.role).toBe("admin");
    });

    it("prevents demoting the last admin with 409 last_admin", async () => {
      const otherAdminId = randomUUID();
      h.state.users.set(otherAdminId, {
        id: otherAdminId,
        phone: "+994505556677",
        full_name: "Other Admin",
        role: "admin",
      });

      // Remove acting admin so otherAdminId is the sole admin
      h.state.users.delete("admin-actor-id");

      const res = await fetch(`${baseUrl}/admin/users/${otherAdminId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "staff" }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("last_admin");
    });

    it("returns 200 without rpc call when setting the same role", async () => {
      const staffId = randomUUID();
      h.state.users.set(staffId, {
        id: staffId,
        phone: "+994507778899",
        full_name: "Staff",
        role: "staff",
      });

      const res = await fetch(`${baseUrl}/admin/users/${staffId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "staff" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; old_role: string; new_role: string };
      expect(body.success).toBe(true);
      expect(body.old_role).toBe("staff");
      expect(body.new_role).toBe("staff");

      const setRoleCall = h.state.rpcCalls.find((c) => c.fn === "set_user_role");
      expect(setRoleCall).toBeUndefined();
    });
  });
});
