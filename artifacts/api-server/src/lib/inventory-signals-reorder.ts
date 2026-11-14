import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchReorderFallback(
  admin: SupabaseClient,
  windowDays: number = 28,
  targetDays: number = 60,
  minSales: number = 3
) {
  const windowDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: variants } = await (admin as any)
    .from("product_variants")
    .select(`
      id, product_id, sku, unit_of_measure, on_hand,
      products!inner ( id, slug ),
      variant_barcodes ( barcode ),
      product_translations:products ( product_translations ( lang_code, title ) )
    `)
    .eq("track_stock", true);

  if (!variants || variants.length === 0) return [];
  const vIds = variants.map((v: any) => v.id);

  const { data: resRows } = await (admin as any)
    .from("reservations")
    .select("variant_id, quantity")
    .eq("status", "active");
  const resMap: Record<string, number> = {};
  for (const r of resRows ?? []) {
    resMap[r.variant_id] = (resMap[r.variant_id] || 0) + Number(r.quantity || 0);
  }

  const { data: movements } = await (admin as any)
    .from("stock_movements")
    .select("variant_id, quantity_delta, reason, posting_date, transaction_id, reference_id")
    .in("variant_id", vIds)
    .in("reason", ["online_sale", "counter_sale"])
    .gte("posting_date", windowDate);

  const soldMap: Record<string, { totalSold: number; txSet: Set<string> }> = {};
  for (const m of movements ?? []) {
    if (!soldMap[m.variant_id]) soldMap[m.variant_id] = { totalSold: 0, txSet: new Set() };
    soldMap[m.variant_id].totalSold += -Number(m.quantity_delta);
    const txId = m.transaction_id || m.reference_id || `${m.posting_date}`;
    soldMap[m.variant_id].txSet.add(txId);
  }

  const { data: grLines } = await (admin as any)
    .from("goods_receipt_lines")
    .select(`
      variant_id,
      goods_receipts!inner ( id, supplier_id, posting_date, status )
    `)
    .eq("goods_receipts.status", "posted")
    .in("variant_id", vIds);

  const supIds = Array.from(
    new Set((grLines ?? []).map((l: any) => l.goods_receipts?.supplier_id).filter(Boolean))
  );
  const { data: supRows } =
    supIds.length > 0
      ? await (admin as any).from("suppliers").select("id, name, contact_info").in("id", supIds)
      : { data: [] };

  const supById: Record<string, any> = Object.fromEntries(
    (supRows ?? []).map((s: any) => [s.id, s])
  );
  const supMap: Record<string, any> = {};
  for (const line of grLines ?? []) {
    const sId = line.goods_receipts?.supplier_id;
    if (sId && supById[sId] && !supMap[line.variant_id]) {
      supMap[line.variant_id] = supById[sId];
    }
  }

  const results: any[] = [];
  for (const v of variants) {
    const soldInfo = soldMap[v.id];
    const totalSold = soldInfo?.totalSold || 0;
    const salesCount = soldInfo?.txSet.size || 0;

    const onHand = Number(v.on_hand || 0);
    const reserved = Number(resMap[v.id] || 0);
    const available = onHand - reserved;

    const velocity = Number((totalSold / windowDays).toFixed(4));
    const hasEnoughData = salesCount >= minSales;
    const daysOfCover = velocity > 0 ? Number((Math.max(0, available) / velocity).toFixed(1)) : 0;
    const suggestedQty = Math.max(0, Math.ceil(targetDays * velocity - available));

    if (suggestedQty <= 0 && velocity <= 0) continue;

    const trans = v.product_translations?.product_translations ?? [];
    const azTitle = trans.find((t: any) => t.lang_code === "az")?.title;
    const title = azTitle || trans[0]?.title || v.products?.slug || v.sku;
    const sup = supMap[v.id];

    results.push({
      variant_id: v.id,
      product_id: v.product_id,
      product_title: title,
      variant_sku: v.sku,
      barcode: v.variant_barcodes?.[0]?.barcode || null,
      unit_of_measure: v.unit_of_measure || "pcs",
      supplier_id: sup?.id || null,
      supplier_name: sup?.name || "Təyin edilməyib",
      supplier_contact: sup?.contact_info || null,
      on_hand: onHand,
      reserved_quantity: reserved,
      available_quantity: available,
      units_sold_window: totalSold,
      sales_count: salesCount,
      velocity,
      days_of_cover: daysOfCover,
      suggested_qty: suggestedQty,
      has_enough_data: hasEnoughData,
    });
  }

  results.sort((a, b) => (b.has_enough_data ? 1 : 0) - (a.has_enough_data ? 1 : 0) || a.days_of_cover - b.days_of_cover);
  return results;
}
