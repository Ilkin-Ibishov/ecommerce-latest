import { Router, type Request, type Response } from "express";
import { getAdminSupabase, getSupabase } from "../../lib/supabase";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { writeAudit } from "../../lib/audit";

const router = Router();

async function requireStaffOrAdmin(req: Request, res: Response, next: () => void): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const supabase = getSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  const admin = getAdminSupabase();
  const { data: profile } = await (admin as any).from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "staff") {
    res.status(403).json({ error: "Forbidden: staff or admin required" });
    return;
  }
  (req as any).user = user;
  (req as any).userRole = profile.role;
  (req as any).admin = admin;
  next();
}

// GET /admin/suppliers
router.get("/admin/suppliers", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const { data, error } = await (admin as any)
    .from("suppliers")
    .select("id, name, contact_info, notes, is_active, created_at, updated_at")
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// GET /admin/suppliers/:id
router.get("/admin/suppliers/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { data, error } = await (admin as any)
    .from("suppliers")
    .select("id, name, contact_info, notes, is_active, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Supplier not found" });
  return res.json(data);
});

// POST /admin/suppliers
router.post("/admin/suppliers", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const { name, contact_info, notes, is_active } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Supplier name is required" });
  }

  const { data, error } = await (admin as any)
    .from("suppliers")
    .insert({
      name: name.trim(),
      contact_info: contact_info ? String(contact_info).trim() : null,
      notes: notes ? String(notes).trim() : null,
      is_active: is_active !== undefined ? !!is_active : true,
    })
    .select("id, name, contact_info, notes, is_active, created_at, updated_at")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  writeAudit({ admin, req, actorId: user.id, action: "create_supplier", entityType: "supplier", entityId: data.id, details: req.body });
  return res.status(201).json(data);
});

// PATCH /admin/suppliers/:id
router.patch("/admin/suppliers/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { name, contact_info, notes, is_active } = req.body;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Supplier name cannot be empty" });
    }
    updates.name = name.trim();
  }
  if (contact_info !== undefined) updates.contact_info = contact_info ? String(contact_info).trim() : null;
  if (notes !== undefined) updates.notes = notes ? String(notes).trim() : null;
  if (is_active !== undefined) updates.is_active = !!is_active;

  const { data, error } = await (admin as any)
    .from("suppliers")
    .update(updates)
    .eq("id", id)
    .select("id, name, contact_info, notes, is_active, created_at, updated_at")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  writeAudit({ admin, req, actorId: user.id, action: "update_supplier", entityType: "supplier", entityId: id, details: updates });
  return res.json(data);
});

// DELETE /admin/suppliers/:id (Admin only)
router.delete("/admin/suppliers/:id", requireAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { error } = await (admin as any).from("suppliers").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });

  writeAudit({ admin, req, actorId: user?.id, action: "delete_supplier", entityType: "supplier", entityId: id, details: {} });
  return res.json({ success: true });
});

export default router;
