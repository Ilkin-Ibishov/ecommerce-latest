import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchLowStockFallback(
  admin: SupabaseClient,
  search?: string | null,
  status?: string | null
) {
  const { data: settingRow } = await (admin as any)
    .from("store_settings")
    .select("value")
    .eq("key", "low_stock_threshold")
    .maybeSingle();
  const globalThreshold = settingRow?.value ? Number(settingRow.value) : 10;

  const { data: variants, error: vErr } = await (admin as any)
    .from("product_variants")
    .select(`
      id, product_id, sku, unit_of_measure, on_hand, low_stock_threshold,
      products!inner ( id, slug ),
      variant_barcodes ( barcode ),
      product_translations:products ( product_translations ( lang_code, title ) )
    `)
    .eq("track_stock", true);

  if (vErr || !variants) return [];

  const { data: resRows } = await (admin as any)
    .from("reservations")
    .select("variant_id, quantity")
    .eq("status", "active");

  const resMap: Record<string, number> = {};
  for (const r of resRows ?? []) {
    resMap[r.variant_id] = (resMap[r.variant_id] || 0) + Number(r.quantity || 0);
  }

  const results: any[] = [];
  const searchLower = (search || "").trim().toLowerCase();

  for (const v of variants) {
    const onHand = Number(v.on_hand || 0);
    const reserved = Number(resMap[v.id] || 0);
    const available = Math.max(0, onHand - reserved);
    const threshold = v.low_stock_threshold !== null && v.low_stock_threshold !== undefined
      ? Number(v.low_stock_threshold)
      : globalThreshold;

    if (available > threshold) continue;

    const itemStatus = available <= 0 ? "out" : "low";
    if (status && status !== itemStatus) continue;

    const trans = v.product_translations?.product_translations ?? [];
    const azTitle = trans.find((t: any) => t.lang_code === "az")?.title;
    const title = azTitle || trans[0]?.title || v.products?.slug || v.sku;
    const barcode = v.variant_barcodes?.[0]?.barcode || null;

    if (searchLower) {
      const matchSku = (v.sku || "").toLowerCase().includes(searchLower);
      const matchTitle = (title || "").toLowerCase().includes(searchLower);
      const matchBarcode = (barcode || "").toLowerCase().includes(searchLower);
      if (!matchSku && !matchTitle && !matchBarcode) continue;
    }

    results.push({
      variant_id: v.id,
      product_id: v.product_id,
      product_title: title,
      variant_sku: v.sku,
      barcode,
      unit_of_measure: v.unit_of_measure || "pcs",
      on_hand: onHand,
      reserved_quantity: reserved,
      available_quantity: available,
      threshold,
      status: itemStatus,
    });
  }

  results.sort((a, b) => {
    if ((a.available_quantity <= 0) !== (b.available_quantity <= 0)) {
      return a.available_quantity <= 0 ? -1 : 1;
    }
    return a.available_quantity - b.available_quantity;
  });

  return results;
}

export async function fetchDeadStockFallback(
  admin: SupabaseClient,
  days: number = 90
) {
  const windowDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: variants, error: vErr } = await (admin as any)
    .from("product_variants")
    .select(`
      id, product_id, sku, unit_of_measure, on_hand,
      products!inner ( id, slug ),
      variant_barcodes ( barcode ),
      product_translations:products ( product_translations ( lang_code, title ) )
    `)
    .eq("track_stock", true)
    .gt("on_hand", 0);

  if (vErr || !variants || variants.length === 0) return [];
  const vIds = variants.map((v: any) => v.id);

  const { data: costRows } = await (admin as any)
    .from("variant_costs")
    .select("variant_id, cost_price, opening_cost")
    .in("variant_id", vIds);
  const costMap: Record<string, number> = {};
  for (const c of costRows ?? []) {
    costMap[c.variant_id] = Number(c.cost_price ?? c.opening_cost ?? 0);
  }

  const { data: movements } = await (admin as any)
    .from("stock_movements")
    .select("variant_id, quantity_delta, reason, posting_date")
    .in("variant_id", vIds);

  const firstReceiptMap: Record<string, string> = {};
  const lastSaleMap: Record<string, string> = {};
  const trailingSalesMap: Record<string, number> = {};

  for (const m of movements ?? []) {
    const postDate = m.posting_date || "";
    if (!firstReceiptMap[m.variant_id] || postDate < firstReceiptMap[m.variant_id]) {
      firstReceiptMap[m.variant_id] = postDate;
    }

    if (["online_sale", "counter_sale"].includes(m.reason)) {
      if (m.quantity_delta < 0) {
        if (!lastSaleMap[m.variant_id] || postDate > lastSaleMap[m.variant_id]) {
          lastSaleMap[m.variant_id] = postDate;
        }
      }
      if (postDate >= windowDate) {
        trailingSalesMap[m.variant_id] = (trailingSalesMap[m.variant_id] || 0) + (-Number(m.quantity_delta));
      }
    }
  }

  const results: any[] = [];
  const nowMs = Date.now();

  for (const v of variants) {
    const firstReceived = firstReceiptMap[v.id];
    if (!firstReceived || new Date(firstReceived) > new Date(windowDate)) continue;

    const netTrailing = trailingSalesMap[v.id] || 0;
    if (netTrailing > 0) continue;

    const onHand = Number(v.on_hand || 0);
    const unitCost = costMap[v.id] || 0;
    const capitalTiedUp = Math.round(onHand * unitCost * 100) / 100;

    const trans = v.product_translations?.product_translations ?? [];
    const azTitle = trans.find((t: any) => t.lang_code === "az")?.title;
    const title = azTitle || trans[0]?.title || v.products?.slug || v.sku;

    const lastSaleDate = lastSaleMap[v.id];
    const daysSinceLastSale = lastSaleDate
      ? Math.max(0, Math.floor((nowMs - new Date(lastSaleDate).getTime()) / (24 * 60 * 60 * 1000)))
      : Math.max(0, Math.floor((nowMs - new Date(firstReceived).getTime()) / (24 * 60 * 60 * 1000)));

    const daysSinceFirstReceipt = Math.max(
      0,
      Math.floor((nowMs - new Date(firstReceived).getTime()) / (24 * 60 * 60 * 1000))
    );

    results.push({
      variant_id: v.id,
      product_id: v.product_id,
      product_title: title,
      variant_sku: v.sku,
      barcode: v.variant_barcodes?.[0]?.barcode || null,
      unit_of_measure: v.unit_of_measure || "pcs",
      on_hand: onHand,
      days_since_last_sale: daysSinceLastSale,
      days_since_first_receipt: daysSinceFirstReceipt,
      unit_cost: unitCost,
      capital_tied_up: capitalTiedUp,
    });
  }

  results.sort((a, b) => b.capital_tied_up - a.capital_tied_up);
  return results;
}
