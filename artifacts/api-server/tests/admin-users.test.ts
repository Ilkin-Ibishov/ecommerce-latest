import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

interface MockUser {
  id: string;
  phone: string;
  full_name: string | null;
  role: string;
}

const h = vi.hoisted(() => {
  const state = {
    isAdmin: true,
    actingUserId: "admin-actor-id",
    users: new Map<string, MockUser>(),
    authCreated: [] as Array<{ id: string; phone: string; phone_confirm: boolean }>,
    auditLogs: [] as any[],
  };
  function reset() {
    state.isAdmin = true;
    state.actingUserId = "admin-actor-id";
    state.users.clear();
    state.authCreated.length = 0;
    state.auditLogs.length = 0;
    state.users.set("admin-actor-id", {
      id: "admin-actor-id", phone: "+994500000001", full_name: "Admin", role: "admin",
    });
  }
  return { state, reset };
});

vi.mock("../src/middlewares/requireAdmin", () => ({
  requireAdmin: (req: any, res: any, next: () => void) => {
    if (!h.state.isAdmin) return res.status(403).json({ error: "Forbidden" });
    req.user = { id: h.state.actingUserId };
    req.admin = {
      from: (table: string) => table === "users" ? {
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: () => {
              const u = Array.from(h.state.users.values()).find((x: any) => x[col] === val);
              return Promise.resolve({ data: u ?? null, error: null });
            },
          }),
        }),
        update: (payload: any) => ({
          eq: (col: string, val: string) => {
            const u = Array.from(h.state.users.values()).find((x: any) => x[col] === val);
            if (u) Object.assign(u, payload);
            return Promise.resolve({ data: u, error: null });
          },
        }),
        insert: (payload: any) => {
          h.state.users.set(payload.id, { ...payload });
          return Promise.resolve({ data: payload, error: null });
        },
      } : {},
      auth: {
        admin: {
          createUser: ({ phone, phone_confirm }: any) => {
            const id = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            h.state.authCreated.push({ id, phone, phone_confirm });
            return Promise.resolve({ data: { user: { id } }, error: null });
          },
          listUsers: () => Promise.resolve({ data: { users: [] }, error: null }),
        },
      },
    };
    next();
  },
}));

vi.mock("../src/lib/audit", () => ({
  writeAudit: (entry: any) => { h.state.auditLogs.push(entry); },
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const usersRouter = (await import("../src/routes/admin/users")).default;
  const app = express();
  app.use(express.json());
  app.use(usersRouter);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => { h.reset(); });

describe("Admin Users & Staff Management", () => {
  it("creates new staff user, writes audit log, and confirms phone", async () => {
    const res = await fetch(`${baseUrl}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+994 50 123 45 67", full_name: "Ali", role: "staff" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.user.phone).toBe("+994501234567");
    expect(body.user.role).toBe("staff");
    expect(h.state.authCreated[0]).toEqual({ id: body.user.id, phone: "+994501234567", phone_confirm: true });
    expect(h.state.auditLogs.find((a) => a.action === "create_staff")?.entityId).toBe(body.user.id);
  });

  it("promotes existing customer to staff when phone exists", async () => {
    h.state.users.set("c-1", { id: "c-1", phone: "+994509998877", full_name: "Cust", role: "customer" });
    const res = await fetch(`${baseUrl}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+994509998877", role: "staff" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.promoted).toBe(true);
    expect(h.state.users.get("c-1")?.role).toBe("staff");
    expect(h.state.authCreated).toHaveLength(0);
    expect(h.state.auditLogs.find((a) => a.action === "create_staff")?.entityId).toBe("c-1");
  });

  it("rejects duplicate staff or admin creation with 400", async () => {
    h.state.users.set("s-1", { id: "s-1", phone: "+994505554433", full_name: "Staff", role: "staff" });
    const res = await fetch(`${baseUrl}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+994505554433", role: "staff" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid phone numbers and non-staff/admin roles on POST", async () => {
    const resPhone = await fetch(`${baseUrl}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "invalid", role: "staff" }),
    });
    expect(resPhone.status).toBe(400);

    const resRole = await fetch(`${baseUrl}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+994501112233", role: "customer" }),
    });
    expect(resRole.status).toBe(400);
  });

  it("prevents self-demotion on PATCH /admin/users/:id/role", async () => {
    const res = await fetch(`${baseUrl}/admin/users/admin-actor-id/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "staff" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Cannot remove your own admin role");
    expect(h.state.users.get("admin-actor-id")?.role).toBe("admin");
  });

  it("allows updating role to staff, admin, or customer and rejects invalid role", async () => {
    h.state.users.set("u-2", { id: "u-2", phone: "+994508887766", full_name: "User2", role: "customer" });
    const resStaff = await fetch(`${baseUrl}/admin/users/u-2/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "staff" }),
    });
    expect(resStaff.status).toBe(200);
    expect(h.state.users.get("u-2")?.role).toBe("staff");

    const resAdmin = await fetch(`${baseUrl}/admin/users/u-2/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(resAdmin.status).toBe(200);
    expect(h.state.users.get("u-2")?.role).toBe("admin");

    const resBad = await fetch(`${baseUrl}/admin/users/u-2/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "superadmin" }),
    });
    expect(resBad.status).toBe(400);
  });
});
