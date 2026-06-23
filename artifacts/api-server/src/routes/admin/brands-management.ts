import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { validate } from "../../middlewares/validate";
import { CreateBrandSchema, UpdateBrandSchema, ReorderBrandsSchema } from "./schemas";
import { writeAudit } from "../../lib/audit";

const router = Router();

// GET /admin/brands — list all ordered by sort_order asc
router.get("/admin/brands", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.admin!;
  const { data, error } = await admin
    .from("brand_entries")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    res.status(500).json({ error: "Failed to fetch brands" });
    return;
  }
  res.json(data ?? []);
});

// POST /admin/brands — create with auto sort_order, 409 on duplicate name
router.post("/admin/brands", requireAdmin, validate(CreateBrandSchema), async (req, res): Promise<void> => {
  const admin = req.admin!;
  const body = req.validatedBody as {
    name: string;
    logo_url: string;
    sort_order?: number;
    is_active?: boolean;
  };

  // Check duplicate name (case-insensitive)
  const { data: existing } = await admin
    .from("brand_entries")
    .select("id")
    .ilike("name", body.name)
    .limit(1);

  if (existing && existing.length > 0) {
    res.status(409).json({ error: "Brand name already exists" });
    return;
  }

  // Determine sort_order: use provided value, or auto-assign max+1
  let sortOrder: number;
  if (body.sort_order != null) {
    sortOrder = body.sort_order;
  } else {
    const { data: maxRow } = await admin
      .from("brand_entries")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1);

    sortOrder = maxRow && maxRow.length > 0 ? maxRow[0].sort_order + 1 : 0;
  }

  const { data, error } = await admin
    .from("brand_entries")
    .insert({
      name: body.name,
      logo_url: body.logo_url,
      sort_order: sortOrder,
      is_active: body.is_active ?? true,
    })
    .select("id")
    .single();

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  writeAudit({
    admin,
    req,
    actorId: req.user!.id,
    action: "create_brand",
    entityType: "brand",
    entityId: data.id,
    details: { name: body.name, logo_url: body.logo_url, sort_order: sortOrder },
  });

  res.status(201).json({ id: data.id });
});

// PATCH /admin/brands/reorder — bulk reorder (registered BEFORE /:id)
router.patch("/admin/brands/reorder", requireAdmin, validate(ReorderBrandsSchema), async (req, res): Promise<void> => {
  const admin = req.admin!;
  const body = req.validatedBody as { ids: string[] };

  // Fetch all existing brand IDs
  const { data: allBrands, error: fetchError } = await admin
    .from("brand_entries")
    .select("id");

  if (fetchError) {
    res.status(500).json({ error: "Failed to fetch brands" });
    return;
  }

  const existingIds = new Set((allBrands ?? []).map((b) => b.id));

  // Validate completeness: all provided IDs must exist
  for (const id of body.ids) {
    if (!existingIds.has(id)) {
      res.status(400).json({ error: `Brand ID ${id} does not exist` });
      return;
    }
  }

  // All existing brand IDs must be included in the request
  if (body.ids.length !== existingIds.size) {
    res.status(400).json({ error: "Request must include all brand IDs" });
    return;
  }

  // Assign sort_order based on array index (0-based)
  for (let i = 0; i < body.ids.length; i++) {
    const { error: updateError } = await admin
      .from("brand_entries")
      .update({ sort_order: i })
      .eq("id", body.ids[i]);

    if (updateError) {
      res.status(500).json({ error: "Failed to update sort order" });
      return;
    }
  }

  writeAudit({
    admin,
    req,
    actorId: req.user!.id,
    action: "reorder_brands",
    entityType: "brand",
    details: { ids: body.ids },
  });

  res.json({ success: true });
});

// PATCH /admin/brands/:id — partial update, 409 on name conflict, 404 if missing
router.patch("/admin/brands/:id", requireAdmin, validate(UpdateBrandSchema), async (req, res): Promise<void> => {
  const admin = req.admin!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = req.validatedBody as {
    name?: string;
    logo_url?: string;
    sort_order?: number;
    is_active?: boolean;
  };

  // Check the brand exists
  const { data: brand } = await admin
    .from("brand_entries")
    .select("id")
    .eq("id", raw)
    .single();

  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  // Check duplicate name (case-insensitive), excluding current entry
  if (body.name != null) {
    const { data: conflict } = await admin
      .from("brand_entries")
      .select("id")
      .ilike("name", body.name)
      .neq("id", raw)
      .limit(1);

    if (conflict && conflict.length > 0) {
      res.status(409).json({ error: "Brand name already exists" });
      return;
    }
  }

  // Build update payload — only include defined fields
  const updatePayload: { name?: string; logo_url?: string; sort_order?: number; is_active?: boolean } = {};
  if (body.name != null) updatePayload.name = body.name;
  if (body.logo_url != null) updatePayload.logo_url = body.logo_url;
  if (body.sort_order != null) updatePayload.sort_order = body.sort_order;
  if (body.is_active != null) updatePayload.is_active = body.is_active;

  const { error } = await admin
    .from("brand_entries")
    .update(updatePayload)
    .eq("id", raw);

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  writeAudit({
    admin,
    req,
    actorId: req.user!.id,
    action: "update_brand",
    entityType: "brand",
    entityId: raw,
    details: updatePayload,
  });

  res.json({ success: true });
});

// DELETE /admin/brands/:id — remove, 404 if missing
router.delete("/admin/brands/:id", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.admin!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Check the brand exists
  const { data: brand } = await admin
    .from("brand_entries")
    .select("id")
    .eq("id", raw)
    .single();

  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const { error } = await admin
    .from("brand_entries")
    .delete()
    .eq("id", raw);

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  writeAudit({
    admin,
    req,
    actorId: req.user!.id,
    action: "delete_brand",
    entityType: "brand",
    entityId: raw,
    details: {},
  });

  res.json({ success: true });
});

export default router;
