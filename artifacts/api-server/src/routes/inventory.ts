import { Router, Request, Response } from "express";
import { getAdminSupabase, getSupabase } from "../lib/supabase";
import { requireAdmin } from "../middlewares/requireAdmin";
import { writeAudit } from "../lib/audit";

const router = Router();

// Middleware: allow staff or admin
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
  const { data: profile } = await (admin as any)
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== "staff") {
    res.status(403).json({ error: "Forbidden: staff or admin required" });
    return;
  }

  (req as any).user = user;
  (req as any).userRole = profile.role;
  (req as any).admin = admin;
  next();
}

// ─── 1. Barcode Scan Lookup (F2 Auth & F3 Multi-Variant List) ─
router.get("/inventory/scan/:barcode", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const barcode = Array.isArray(req.params.barcode) ? req.params.barcode[0] : req.params.barcode;

  // Query variant_barcodes table (F3 / identification scenario matrix)
  const { data: barcodeRows, error } = await (admin as any)
    .from("variant_barcodes")
    .select(`
      barcode,
      is_primary,
      source,
      product_variants!inner (
        id, sku, price, on_hand, unit_of_measure, is_default, product_id,
        products (
          id, slug,
          product_translations (lang_code, title),
          product_images (url, sort_order)
        ),
        variant_option_values (
          product_option_values (
            value,
            product_option_types (name)
          )
        )
      )
    `)
    .eq("barcode", barcode);

  if (error || !barcodeRows || barcodeRows.length === 0) {
    return res.status(404).json({ error: "Barcode not found" });
  }

  const results = barcodeRows
    .filter((row: any) => row.product_variants)
    .map((row: any) => {
      const variant = row.product_variants;
      const prod = variant.products;
      const title = prod?.product_translations?.find((t: any) => t.lang_code === "az")?.title
        ?? prod?.product_translations?.[0]?.title ?? "Product";
      const sortedImages = [...(prod?.product_images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
      const imageUrl = sortedImages[0]?.url ?? null;

      const options = (variant.variant_option_values ?? []).map((vov: any) => ({
        name: vov?.product_option_values?.product_option_types?.name ?? "Option",
        value: vov?.product_option_values?.value ?? "",
      }));

      return {
        variant: {
          id: variant.id,
          sku: variant.sku,
          barcode: row.barcode,
          price: Number(variant.price),
          on_hand: Number(variant.on_hand),
          unit_of_measure: variant.unit_of_measure,
          options,
        },
        product: {
          id: prod?.id ?? variant.product_id,
          title,
          slug: prod?.slug ?? "",
          image_url: imageUrl,
        },
      };
    });

  if (results.length === 0) {
    return res.status(404).json({ error: "Barcode not found" });
  }

  return res.json(results);
});

// ─── 2. Variant Movement History (Deliverables §7 item 6 / F4 unit_cost secrecy) ──
router.get("/admin/variants/:id/movements", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const userRole = (req as any).userRole;
  const variantId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { data: movements, error } = await (admin as any)
    .from("stock_movements")
    .select(`
      id, variant_id, quantity_delta, reason, reference_type, reference_id,
      unit_cost, note, created_at,
      users(id, full_name, role)
    `)
    .eq("variant_id", variantId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // F4: Restrict unit_cost exclusively to admin. Staff must not see unit_cost or derive margins.
  const isStaff = userRole === "staff";
  const sanitized = (movements ?? []).map((m: any) => {
    if (isStaff) {
      const { unit_cost, ...safeRow } = m;
      return safeRow;
    }
    return m;
  });

  return res.json({ movements: sanitized });
});

// ─── 3. Variant Management for Product ────────────────────────
router.get("/admin/products/:id/variants", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const userRole = (req as any).userRole;
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const selectCols = userRole === "admin"
    ? `
      id, product_id, sku, price, on_hand, unit_of_measure, is_default, sort_order,
      variant_barcodes (id, barcode, source, is_primary),
      variant_option_values(option_value_id, product_option_values(id, value, option_type_id)),
      variant_costs (cost_price)
    `
    : `
      id, product_id, sku, price, on_hand, unit_of_measure, is_default, sort_order,
      variant_barcodes (id, barcode, source, is_primary),
      variant_option_values(option_value_id, product_option_values(id, value, option_type_id))
    `;

  const { data: variants, error } = await (admin as any)
    .from("product_variants")
    .select(selectCols)
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const mapped = (variants ?? []).map((v: any) => {
    const primary = (v.variant_barcodes ?? []).find((b: any) => b.is_primary) ?? v.variant_barcodes?.[0];
    const costPrice = userRole === "admin"
      ? (Array.isArray(v.variant_costs) ? v.variant_costs[0]?.cost_price : v.variant_costs?.cost_price) ?? 0
      : undefined;

    return {
      ...v,
      barcode: primary?.barcode ?? null,
      barcodes: v.variant_barcodes ?? [],
      ...(userRole === "admin" ? { cost_price: costPrice } : {}),
    };
  });

  return res.json({ variants: mapped });
});

// Create a variant
router.post("/admin/products/:id/variants", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { sku, barcode, price, initial_quantity, unit_of_measure, sort_order, option_value_ids, cost_price } = req.body;

  if (typeof price !== "number" || price < 0) {
    return res.status(400).json({ error: "price must be a non-negative number" });
  }

  const { data: variant, error } = await (admin as any)
    .from("product_variants")
    .insert({
      product_id: productId,
      sku: sku ? String(sku).trim() : null,
      price,
      on_hand: 0,
      unit_of_measure: unit_of_measure || "pcs",
      is_default: false,
      sort_order: sort_order ?? 0,
    })
    .select("id")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Attach barcode to variant_barcodes table (F3)
  if (barcode && String(barcode).trim()) {
    await (admin as any).from("variant_barcodes").insert({
      variant_id: variant.id,
      barcode: String(barcode).trim(),
      source: "manufacturer",
      is_primary: true,
    });
  }

  // Attach option values
  if (Array.isArray(option_value_ids) && option_value_ids.length > 0) {
    await (admin as any).from("variant_option_values").insert(
      option_value_ids.map((valId: string) => ({ variant_id: variant.id, option_value_id: valId }))
    );
  }

  // Cost price (admin only)
  await (admin as any).from("variant_costs").insert({
    variant_id: variant.id,
    cost_price: (req as any).userRole === "admin" && typeof cost_price === "number" && cost_price >= 0 ? cost_price : 0,
  });

  // Initial stock movement
  const openingQty = Number(initial_quantity ?? 0);
  if (openingQty > 0) {
    await (admin as any).from("stock_movements").insert({
      variant_id: variant.id,
      quantity_delta: openingQty,
      reason: "opening_balance",
      reference_type: "manual",
      actor_id: user.id,
      note: "Initial variant opening balance",
    });
  }

  writeAudit({ admin, req, actorId: user.id, action: "create_variant", entityType: "product_variant", entityId: variant.id, details: req.body });
  return res.status(201).json({ id: variant.id });
});

// Update variant (Staff forbidden from modifying price, enforced by DB trigger and API)
router.patch("/admin/variants/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const userRole = (req as any).userRole;
  const variantId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { sku, barcode, price, unit_of_measure, sort_order, is_default, cost_price } = req.body;

  if (price !== undefined && userRole === "staff") {
    return res.status(403).json({ error: "Staff are not permitted to change product prices" });
  }

  const updates: Record<string, unknown> = {};
  if (sku !== undefined) updates.sku = sku ? String(sku).trim() : null;
  if (price !== undefined) updates.price = price;
  if (unit_of_measure !== undefined) updates.unit_of_measure = unit_of_measure;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (is_default !== undefined) updates.is_default = is_default;

  if (Object.keys(updates).length > 0) {
    const { error } = await (admin as any).from("product_variants").update(updates).eq("id", variantId);
    if (error) return res.status(400).json({ error: error.message });
  }

  // Handle barcode update in variant_barcodes table (F3)
  if (barcode !== undefined) {
    const trimmed = barcode ? String(barcode).trim() : null;
    if (trimmed) {
      await (admin as any).from("variant_barcodes").upsert(
        {
          variant_id: variantId,
          barcode: trimmed,
          source: "manufacturer",
          is_primary: true,
        },
        { onConflict: "variant_id,barcode" }
      );
    }
  }

  // Handle cost price update for admin (F6)
  if (userRole === "admin" && cost_price !== undefined) {
    await (admin as any).from("variant_costs").upsert(
      {
        variant_id: variantId,
        cost_price: typeof cost_price === "number" && cost_price >= 0 ? cost_price : 0,
      },
      { onConflict: "variant_id" }
    );
  }

  writeAudit({ admin, req, actorId: user.id, action: "update_variant", entityType: "product_variant", entityId: variantId, details: { ...updates, barcode, ...(userRole === "admin" ? { cost_price } : {}) } });
  return res.json({ success: true });
});

// ─── 4. Stock Adjustment via Movement Ledger ──────────────────
router.post("/admin/stock/adjust", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const userRole = (req as any).userRole;
  const { variant_id, quantity_delta, reason, note, unit_cost } = req.body;

  if (!variant_id || typeof quantity_delta !== "number" || quantity_delta === 0) {
    return res.status(400).json({ error: "variant_id and non-zero numeric quantity_delta are required" });
  }

  const VALID_REASONS = [
    "goods_receipt", "online_sale", "counter_sale", "customer_return",
    "return_to_supplier", "damage_write_off", "stocktake_correction",
    "manual_adjustment", "opening_balance",
  ];
  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: `Invalid reason. Allowed: ${VALID_REASONS.join(", ")}` });
  }

  // F5: Restrict opening_balance and stocktake_correction to admin role only
  const ADMIN_ONLY_REASONS = ["opening_balance", "stocktake_correction"];
  if (ADMIN_ONLY_REASONS.includes(reason) && userRole !== "admin") {
    return res.status(403).json({
      error: `Reason '${reason}' is reserved for administrator role only`,
    });
  }

  const { error } = await (admin as any).from("stock_movements").insert({
    variant_id,
    quantity_delta,
    reason,
    reference_type: "manual",
    actor_id: user.id,
    note: note || null,
    unit_cost: userRole === "admin" && typeof unit_cost === "number" && unit_cost >= 0 ? unit_cost : null,
  });

  if (error) {
    if ((error as any).code === "ST001") {
      return res.status(409).json({ error: "Insufficient stock" });
    }
    return res.status(400).json({ error: error.message });
  }

  const { data: updatedVariant } = await (admin as any)
    .from("product_variants")
    .select("id, on_hand")
    .eq("id", variant_id)
    .single();

  writeAudit({ admin, req, actorId: user.id, action: "adjust_stock_movement", entityType: "product_variant", entityId: String(variant_id), details: req.body });
  return res.json({ success: true, on_hand: Number(updatedVariant?.on_hand ?? 0) });
});

export default router;
