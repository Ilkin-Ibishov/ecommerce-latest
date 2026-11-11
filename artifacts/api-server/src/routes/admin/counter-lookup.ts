import { Router, type Request, type Response } from "express";
import { CounterLookupQueryParams } from "@workspace/api-zod";
import { requireStaffOrAdmin } from "../../middlewares/requireStaffOrAdmin";

// Counter screen reads: one box for scanner, typed barcode and typed name (M3 spec §7),
// and the active bundles the screen needs to price a cart. No cost fields.
const router = Router();
const MAX_RESULTS = 20;

// LIKE wildcards in what the cashier typed must match literally.
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

router.get("/admin/counter/lookup", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = CounterLookupQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "q is required" });
    return;
  }
  const admin = req.admin!;
  const q = parsed.data.q.trim();

  // 1. Exact barcode first. A shared colour barcode returns several variants: the picker case.
  const { data: codes, error: codeErr } = await admin
    .from("variant_barcodes").select("variant_id, pack_quantity").eq("barcode", q);
  if (codeErr) {
    res.status(500).json({ error: codeErr.message });
    return;
  }
  const packs = new Map((codes ?? []).map((c) => [c.variant_id, Number(c.pack_quantity) || 1]));
  let ids = [...packs.keys()];
  const matchedBy = ids.length ? "barcode" : "search";

  // 2. Otherwise a case-insensitive substring on SKU or any translation's title.
  if (!ids.length) {
    const pattern = likePattern(q);
    const [bySku, byTitle] = await Promise.all([
      admin.from("product_variants").select("id").ilike("sku", pattern).limit(MAX_RESULTS),
      admin.from("product_translations").select("product_id").ilike("title", pattern).limit(MAX_RESULTS),
    ]);
    const productIds = [...new Set((byTitle.data ?? []).map((t) => t.product_id))];
    const byProduct = productIds.length
      ? await admin.from("product_variants").select("id").in("product_id", productIds).limit(MAX_RESULTS)
      : { data: [] as { id: string }[] };
    ids = [...new Set([...(bySku.data ?? []), ...(byProduct.data ?? [])].map((v) => v.id))].slice(0, MAX_RESULTS);
  }
  if (!ids.length) {
    res.json({ matched_by: matchedBy, items: [] });
    return;
  }

  const [variants, avail, holds] = await Promise.all([
    admin.from("product_variants").select(`
      id, sku, price, on_hand,
      products ( product_translations ( lang_code, title ), product_images ( url, sort_order ) ),
      variant_option_values ( product_option_values ( value, product_option_types ( name ) ) )
    `).in("id", ids),
    admin.from("product_variant_availability").select("variant_id, available_quantity").in("variant_id", ids),
    admin.from("reservations").select("variant_id, reservation_number, customer_name, quantity")
      .in("variant_id", ids).eq("status", "active"),
  ]);
  if (variants.error) {
    res.status(500).json({ error: variants.error.message });
    return;
  }

  const available = new Map((avail.data ?? []).map((a) => [a.variant_id, Number(a.available_quantity)]));
  const items = (variants.data ?? []).map((v) => {
    const translations = v.products?.product_translations ?? [];
    const title = translations.find((t) => t.lang_code === "az")?.title ?? translations[0]?.title ?? v.sku ?? "";
    const images = [...(v.products?.product_images ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const avl = available.get(v.id) ?? Number(v.on_hand);
    return {
      variant_id: v.id,
      sku: v.sku,
      title,
      image: images[0]?.url ?? null,
      options: (v.variant_option_values ?? []).map((o) => ({
        name: o.product_option_values?.product_option_types?.name ?? "",
        value: o.product_option_values?.value ?? "",
      })),
      price: Number(v.price),
      on_hand: Number(v.on_hand),
      available: avl,
      pack_quantity: packs.get(v.id) ?? 1,
      // Staff may see who holds the unit (M2c §9); only shown where nothing is free.
      reservations: avl <= 0 ? (holds.data ?? []).filter((h) => h.variant_id === v.id) : [],
    };
  });
  res.json({ matched_by: matchedBy, items });
});

router.get("/admin/counter/bundles", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await req.admin!
    .from("bundles").select("id, name, bundle_price, bundle_lines ( variant_id, quantity )")
    .eq("is_active", true).order("name");
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json((data ?? []).map((b) => ({ id: b.id, name: b.name, bundle_price: b.bundle_price, lines: b.bundle_lines })));
});

export default router;
