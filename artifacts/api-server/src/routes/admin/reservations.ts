import { Router, type Request, type Response } from "express";
import { getAdminSupabase, getSupabase } from "../../lib/supabase";
import { fulfilReservation } from "../../lib/rpc";
import {
  CreateReservationBody,
  RecordReservationPaymentBody,
  ReleaseReservationBody,
  UpdateReservationPriceBody,
} from "@workspace/api-zod";

const router = Router();

async function requireStaffOrAdmin(req: Request, res: Response, next: () => void): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return void res.status(401).json({ error: "Unauthorized" });
  const supabase = getSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return void res.status(401).json({ error: "Invalid token" });
  const admin = getAdminSupabase();
  const { data: profile } = await (admin as any).from("users").select("role, name").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "staff") {
    return void res.status(403).json({ error: "Forbidden: staff or admin required" });
  }
  (req as any).user = user;
  (req as any).userRole = profile.role;
  (req as any).userName = profile.name;
  (req as any).admin = admin;
  next();
}

function mapReservationRow(r: any) {
  const effective_status = (r.status === "active" && r.expires_at && new Date(r.expires_at) < new Date())
    ? "expired"
    : (r.effective_status ?? r.status);

  return {
    ...r,
    effective_status,
    product_title: r.product_variants?.products?.product_translations?.[0]?.title ?? r.product_title ?? null,
    variant_sku: r.product_variants?.sku ?? r.variant_sku ?? null,
    product_variants: undefined,
  };
}

// ─── 1. List Reservations (Staff & Admin) ───────────────────────────────────
router.get("/admin/reservations", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const { status, search, variant_id } = req.query;

  let query = (admin as any)
    .from("reservations_view")
    .select(`
      *,
      product_variants:variant_id (
        id,
        sku,
        products:product_id (
          id,
          product_translations (
            lang_code,
            title
          )
        )
      )
    `)
    .order("created_at", { ascending: false });

  if (typeof variant_id === "string" && variant_id) {
    query = query.eq("variant_id", variant_id);
  }

  const { data: reservations, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  let results = (reservations ?? []).map(mapReservationRow);

  if (typeof status === "string" && status) {
    results = results.filter((r: any) => r.effective_status === status);
  }

  if (typeof search === "string" && search.trim()) {
    const s = search.trim().toLowerCase();
    results = results.filter((r: any) =>
      r.reservation_number?.toLowerCase().includes(s) ||
      r.customer_name?.toLowerCase().includes(s) ||
      r.customer_phone?.toLowerCase().includes(s) ||
      r.product_title?.toLowerCase().includes(s) ||
      r.variant_sku?.toLowerCase().includes(s)
    );
  }

  return res.json(results);
});

// ─── 2. Aged Reservations List (Owner Only) ─────────────────────────────────
router.get("/admin/reservations/aged", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const userRole = (req as any).userRole;
  if (userRole !== "admin") {
    return res.status(403).json({ error: "Forbidden: only owners can access the aged reservations list" });
  }

  const admin = (req as any).admin;
  const days = req.query.days ? parseInt(String(req.query.days), 10) : 7;
  const thresholdDate = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const { data: reservations, error } = await (admin as any)
    .from("reservations_view")
    .select(`
      *,
      product_variants:variant_id (
        id,
        sku,
        products:product_id (
          id,
          product_translations (
            lang_code,
            title
          )
        )
      )
    `)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const allMapped = (reservations ?? []).map(mapReservationRow);

  // Aged reservations: either expired, or active deposits older than threshold
  const aged = allMapped.filter((r: any) => {
    if (r.effective_status === "expired") return true;
    if (r.effective_status === "active" && (!r.expires_at || r.created_at <= thresholdDate)) {
      return r.created_at <= thresholdDate;
    }
    return false;
  });

  return res.json(aged);
});

// ─── 3. Create Deposit Reservation (Staff & Admin) ───────────────────────────
router.post("/admin/reservations", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const parseResult = CreateReservationBody.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Validation failed", details: parseResult.error.format() });
  }

  const { variant_id, quantity, customer_name, customer_phone, hold_type = "deposit", agreed_price, paid_amount = 0, notes, expires_at } = parseResult.data;
  const admin = (req as any).admin;
  const user = (req as any).user;

  if (paid_amount > agreed_price) {
    return res.status(400).json({ error: "Paid amount cannot exceed agreed price" });
  }

  // Check available stock from product_variant_availability view
  const { data: availData, error: availErr } = await (admin as any)
    .from("product_variant_availability")
    .select("available_quantity, on_hand, reserved_quantity")
    .eq("variant_id", variant_id)
    .single();

  if (availErr || !availData) {
    return res.status(400).json({ error: "Variant not found or unable to check availability" });
  }

  const available = Number(availData.available_quantity);
  if (available < quantity) {
    return res.status(400).json({
      error: `ST014: Insufficient available stock for variant (available: ${available}, requested: ${quantity})`
    });
  }

  const reservationNumber = `RES-${Date.now().toString().slice(-6)}`;

  const { data: created, error: insertErr } = await (admin as any)
    .from("reservations")
    .insert({
      reservation_number: reservationNumber,
      variant_id,
      quantity,
      customer_name,
      customer_phone,
      hold_type,
      status: "active",
      agreed_price,
      paid_amount,
      notes: notes ?? null,
      expires_at: expires_at ? new Date(expires_at).toISOString() : null,
      created_by: user.id,
    })
    .select()
    .single();

  if (insertErr) {
    return res.status(500).json({ error: insertErr.message });
  }

  return res.status(201).json(mapReservationRow(created));
});

// ─── 4. Record Payment Installment (Staff & Admin) ───────────────────────────
router.post("/admin/reservations/:id/payment", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const parseResult = RecordReservationPaymentBody.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Validation failed", details: parseResult.error.format() });
  }

  const { amount } = parseResult.data;
  if (amount <= 0) {
    return res.status(400).json({ error: "Payment amount must be greater than zero" });
  }

  const admin = (req as any).admin;
  const id = String(req.params.id);

  const { data: resRow, error: fetchErr } = await (admin as any)
    .from("reservations")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !resRow) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  if (resRow.status !== "active") {
    return res.status(400).json({ error: `Cannot record payment for reservation in ${resRow.status} status` });
  }

  const newPaid = Number(resRow.paid_amount) + amount;
  if (newPaid > Number(resRow.agreed_price)) {
    return res.status(400).json({
      error: `Payment amount of ${amount} AZN exceeds remaining balance of ${Number(resRow.agreed_price) - Number(resRow.paid_amount)} AZN`
    });
  }

  const { data: updated, error: updateErr } = await (admin as any)
    .from("reservations")
    .update({
      paid_amount: newPaid,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    return res.status(500).json({ error: updateErr.message });
  }

  return res.json(mapReservationRow(updated));
});

// ─── 5. Fulfil Reservation (Staff & Admin) ───────────────────────────────────
router.post("/admin/reservations/:id/fulfil", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = String(req.params.id);
  const finalPayment = req.body?.final_payment !== undefined ? Number(req.body.final_payment) : 0;

  const { data, error } = await fulfilReservation(admin, id, user.id, finalPayment);
  if (error) {
    const msg = (error as any)?.message ?? "Fulfilment failed";
    return res.status(400).json({ error: msg });
  }

  return res.json(mapReservationRow(data));
});

// ─── 6. Release Reservation (Owner Only) ─────────────────────────────────────
router.post("/admin/reservations/:id/release", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const userRole = (req as any).userRole;
  if (userRole !== "admin") {
    return res.status(403).json({ error: "Forbidden: only owners can release reservations" });
  }

  const parseResult = ReleaseReservationBody.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Validation failed", details: parseResult.error.format() });
  }

  const { release_reason } = parseResult.data;
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = String(req.params.id);

  const { data: resRow, error: fetchErr } = await (admin as any)
    .from("reservations")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !resRow) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  if (resRow.status !== "active") {
    return res.status(400).json({ error: `Cannot release reservation in ${resRow.status} status` });
  }

  const { data: updated, error: updateErr } = await (admin as any)
    .from("reservations")
    .update({
      status: "released",
      released_by: user.id,
      released_at: new Date().toISOString(),
      release_reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    return res.status(500).json({ error: updateErr.message });
  }

  return res.json(mapReservationRow(updated));
});

// ─── 7. Update Agreed Price (Owner Only) ─────────────────────────────────────
router.patch("/admin/reservations/:id/price", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const userRole = (req as any).userRole;
  if (userRole !== "admin") {
    return res.status(403).json({ error: "Forbidden: only owners can update the agreed price" });
  }

  const parseResult = UpdateReservationPriceBody.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Validation failed", details: parseResult.error.format() });
  }

  const { agreed_price } = parseResult.data;
  const admin = (req as any).admin;
  const id = String(req.params.id);

  const { data: resRow, error: fetchErr } = await (admin as any)
    .from("reservations")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !resRow) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  if (resRow.status !== "active") {
    return res.status(400).json({ error: `Cannot update price for reservation in ${resRow.status} status` });
  }

  if (agreed_price < Number(resRow.paid_amount)) {
    return res.status(400).json({
      error: `New agreed price (${agreed_price}) cannot be lower than amount already paid (${resRow.paid_amount})`
    });
  }

  const { data: updated, error: updateErr } = await (admin as any)
    .from("reservations")
    .update({
      agreed_price,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    return res.status(500).json({ error: updateErr.message });
  }

  return res.json(mapReservationRow(updated));
});

export default router;
