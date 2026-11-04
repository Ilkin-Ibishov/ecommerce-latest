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
      pack_quantity,
      pack_unit,
      is_primary,
      source,
      product_variants!inner (
        id, sku, price, on_hand, unit_of_measure, track_stock, low_stock_threshold, is_default, product_id,
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

  const variantIds = barcodeRows.map((r: any) => r.product_variants?.id).filter(Boolean);
  const { data: availRows } = await (admin as any)
    .from("product_variant_availability")
    .select("variant_id, reserved_quantity, available_quantity, deficit_quantity")
    .in("variant_id", variantIds);

  const availMap = new Map<string, any>();
  for (const r of availRows ?? []) {
    availMap.set(r.variant_id, r);
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

      const avail = availMap.get(variant.id);
      const onHand = Number(variant.on_hand);
      const reserved = avail ? Number(avail.reserved_quantity) : 0;
      const available = avail ? Number(avail.available_quantity) : Math.max(0, onHand - reserved);
      const deficit = avail ? Number(avail.deficit_quantity) : Math.max(0, reserved - onHand);

      return {
        variant: {
          id: variant.id,
          sku: variant.sku,
          barcode: row.barcode,
          pack_quantity: Number(row.pack_quantity ?? 1),
          pack_unit: row.pack_unit ?? variant.unit_of_measure,
          price: Number(variant.price),
          on_hand: onHand,
          reserved,
          available,
          deficit,
          unit_of_measure: variant.unit_of_measure,
          track_stock: variant.track_stock ?? true,
          low_stock_threshold: variant.low_stock_threshold != null ? Number(variant.low_stock_threshold) : null,
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

  const selectCols = userRole === "admin" ? `id, variant_id, quantity_delta, reason, reference_type, reference_id,
      note, posting_date, transaction_id, correlation_id, created_at,
      users(id, full_name, role),
      stock_movement_costs(unit_cost, total_cost)` : `id, variant_id, quantity_delta, reason, reference_type, reference_id,
      note, posting_date, transaction_id, correlation_id, created_at,
      users(id, full_name, role)`;

  const { data: movements, error } = await (admin as any)
    .from("stock_movements")
    .select(selectCols)
    .eq("variant_id", variantId)
    .order("posting_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const isStaff = userRole === "staff";
  const sanitized = (movements ?? []).map((m: any) => {
    if (isStaff) {
      const { stock_movement_costs, unit_cost, ...safeRow } = m;
      return safeRow;
    }
    const smc = Array.isArray(m.stock_movement_costs) ? m.stock_movement_costs[0] : m.stock_movement_costs;
    const unitCost = smc?.unit_cost != null ? Number(smc.unit_cost) : null;
    const { stock_movement_costs, ...rest } = m;
    return { ...rest, unit_cost: unitCost };
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
      id, product_id, sku, price, on_hand, unit_of_measure, track_stock, low_stock_threshold, is_default, sort_order,
      variant_barcodes (id, barcode, source, is_primary, pack_quantity, pack_unit),
      variant_option_values(option_value_id, product_option_values(id, value, option_type_id)),
      variant_costs (cost_price)
    `
    : `
      id, product_id, sku, price, on_hand, unit_of_measure, track_stock, low_stock_threshold, is_default, sort_order,
      variant_barcodes (id, barcode, source, is_primary, pack_quantity, pack_unit),
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
  const { sku, barcode, price, initial_quantity, unit_of_measure, sort_order, option_value_ids, cost_price, track_stock, low_stock_threshold, pack_quantity, pack_unit } = req.body;

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
      track_stock: track_stock !== undefined ? !!track_stock : true,
      low_stock_threshold: typeof low_stock_threshold === "number" && low_stock_threshold >= 0 ? low_stock_threshold : null,
      is_default: false,
      sort_order: sort_order ?? 0,
    })
    .select("id")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Attach barcode to variant_barcodes table (F3 / A3)
  if (barcode && String(barcode).trim()) {
    await (admin as any).from("variant_barcodes").insert({
      variant_id: variant.id,
      barcode: String(barcode).trim(),
      source: "manufacturer",
      is_primary: true,
      pack_quantity: typeof pack_quantity === "number" && pack_quantity > 0 ? pack_quantity : 1,
      pack_unit: pack_unit ? String(pack_unit).trim() : (unit_of_measure || "pcs"),
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
  const { sku, barcode, price, unit_of_measure, sort_order, is_default, cost_price, track_stock, low_stock_threshold, pack_quantity, pack_unit } = req.body;

  if (price !== undefined && userRole === "staff") {
    return res.status(403).json({ error: "Staff are not permitted to change product prices" });
  }

  const updates: Record<string, unknown> = {};
  if (sku !== undefined) updates.sku = sku ? String(sku).trim() : null;
  if (price !== undefined) updates.price = price;
  if (unit_of_measure !== undefined) updates.unit_of_measure = unit_of_measure;
  if (track_stock !== undefined) updates.track_stock = !!track_stock;
  if (low_stock_threshold !== undefined) {
    updates.low_stock_threshold = typeof low_stock_threshold === "number" && low_stock_threshold >= 0 ? low_stock_threshold : null;
  }
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (is_default !== undefined) updates.is_default = is_default;

  if (Object.keys(updates).length > 0) {
    const { error } = await (admin as any).from("product_variants").update(updates).eq("id", variantId);
    if (error) return res.status(400).json({ error: error.message });
  }

  // Handle barcode update in variant_barcodes table (F3 / A3)
  if (barcode !== undefined) {
    const trimmed = barcode ? String(barcode).trim() : null;
    if (trimmed) {
      const bcRow: Record<string, unknown> = {
        variant_id: variantId,
        barcode: trimmed,
        source: "manufacturer",
        is_primary: true,
      };
      if (typeof pack_quantity === "number" && pack_quantity > 0) bcRow.pack_quantity = pack_quantity;
      if (pack_unit) bcRow.pack_unit = String(pack_unit).trim();

      await (admin as any).from("variant_barcodes").upsert(
        bcRow,
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
  let { variant_id, quantity_delta, reason, note, unit_cost, barcode, pack_count, posting_date, transaction_id, correlation_id } = req.body;

  // A3 / G2: Resolve barcode and pack quantity if barcode is provided (e.g. 1 scan of pack 12 -> 12)
  if (barcode) {
    const cleanBarcode = String(barcode).trim();
    const { data: bRows } = await (admin as any)
      .from("variant_barcodes")
      .select("variant_id, pack_quantity")
      .eq("barcode", cleanBarcode);

    if (bRows && bRows.length > 0) {
      if (!variant_id) {
        // G2 Path 1: reject ambiguous shared barcode without operator disambiguation
        if (bRows.length > 1) {
          const candidates = bRows.map((r: any) => r.variant_id);
          return res.status(400).json({
            error: `Barcode '${cleanBarcode}' matches multiple variants (${candidates.join(", ")}). Please specify variant_id.`,
            candidates,
          });
        }
        variant_id = bRows[0].variant_id;
      }

      // G2 Path 2: read pack_quantity from THAT variant's barcode row
      const matchedRow = bRows.find((r: any) => r.variant_id === variant_id);
      if (!matchedRow) {
        return res.status(400).json({
          error: `Barcode '${cleanBarcode}' does not belong to variant '${variant_id}'`,
        });
      }

      const packQty = Number(matchedRow.pack_quantity ?? 1);
      if (quantity_delta === undefined || quantity_delta === null) {
        const count = typeof pack_count === "number" && pack_count !== 0 ? pack_count : 1;
        quantity_delta = count * packQty;
      }
    }
  }

  if (!variant_id || typeof quantity_delta !== "number" || quantity_delta === 0) {
    return res.status(400).json({ error: "variant_id (or valid barcode) and non-zero numeric quantity_delta are required" });
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

  // A1, A2: Set posting_date, transaction_id, correlation_id on movement row
  const movementRow: Record<string, unknown> = {
    variant_id,
    quantity_delta,
    reason,
    reference_type: "manual",
    actor_id: user.id,
    note: note || null,
      };
  if (posting_date) movementRow.posting_date = posting_date;
  if (transaction_id) movementRow.transaction_id = transaction_id;
  if (correlation_id) movementRow.correlation_id = correlation_id;

  const { error } = await (admin as any).from("stock_movements").insert(movementRow);

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
