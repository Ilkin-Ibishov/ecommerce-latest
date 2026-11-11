import { Router, type Request, type Response } from "express";
import { CreateBundleBody, UpdateBundleBody } from "@workspace/api-zod";
import { requireStaffOrAdmin, ownerOnly } from "../../middlewares/requireStaffOrAdmin";
import { writeAudit } from "../../lib/audit";

// Owner edits bundles (M3 spec §10). Staff read them through GET /admin/counter/bundles.
// ponytail: line replacement is delete-then-insert in two statements, not one transaction;
// a failure in between leaves the bundle without lines until it is saved again. Move it into
// a definer function if that ever happens in practice.
const router = Router();

type Lines = { variant_id: string; quantity: number }[];

async function replaceLines(req: Request, id: string, lines: Lines): Promise<string | null> {
  const admin = req.admin!;
  const del = await admin.from("bundle_lines").delete().eq("bundle_id", id);
  if (del.error) return del.error.message;
  const ins = await admin.from("bundle_lines").insert(lines.map((l) => ({ bundle_id: id, ...l })));
  return ins.error?.message ?? null;
}

const wholeUnits = (lines: Lines) => lines.every((l) => Number.isInteger(l.quantity));

router.get("/admin/bundles", requireStaffOrAdmin, ownerOnly, async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await req.admin!
    .from("bundles").select("id, name, bundle_price, is_active, bundle_lines ( variant_id, quantity, product_variants ( sku ) )").order("name");
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

router.post("/admin/bundles", requireStaffOrAdmin, ownerOnly, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateBundleBody.safeParse(req.body);
  if (!parsed.success || !wholeUnits(parsed.data.lines)) {
    res.status(400).json({ error: "Invalid bundle" });
    return;
  }
  const { lines, ...fields } = parsed.data;
  const { data, error } = await req.admin!.from("bundles")
    .insert({ ...fields, created_by: req.user!.id }).select("id").single();
  if (error || !data) {
    res.status(400).json({ error: error?.message ?? "Insert failed" });
    return;
  }
  const lineErr = await replaceLines(req, data.id, lines);
  if (lineErr) {
    res.status(400).json({ error: lineErr });
    return;
  }
  writeAudit({ admin: req.admin!, req, actorId: req.user!.id, action: "create_bundle", entityType: "bundle", entityId: data.id, details: parsed.data });
  res.status(201).json({ id: data.id });
});

router.put("/admin/bundles/:id", requireStaffOrAdmin, ownerOnly, async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateBundleBody.safeParse(req.body);
  if (!parsed.success || !wholeUnits(parsed.data.lines)) {
    res.status(400).json({ error: "Invalid bundle" });
    return;
  }
  const id = String(req.params.id);
  const { lines, ...fields } = parsed.data;
  const { data, error } = await req.admin!.from("bundles")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (!data?.length) {
    res.status(404).json({ error: "Bundle not found" });
    return;
  }
  const lineErr = await replaceLines(req, id, lines);
  if (lineErr) {
    res.status(400).json({ error: lineErr });
    return;
  }
  writeAudit({ admin: req.admin!, req, actorId: req.user!.id, action: "update_bundle", entityType: "bundle", entityId: id, details: parsed.data });
  res.json({ id });
});

// Deactivate rather than delete: past sales reference the bundle.
router.delete("/admin/bundles/:id", requireStaffOrAdmin, ownerOnly, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { error } = await req.admin!.from("bundles")
    .update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  writeAudit({ admin: req.admin!, req, actorId: req.user!.id, action: "deactivate_bundle", entityType: "bundle", entityId: id, details: {} });
  res.json({ id });
});

export default router;
