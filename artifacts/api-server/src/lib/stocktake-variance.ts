import type { SupabaseClient } from "@supabase/supabase-js";

export interface StocktakeVarianceItem {
  variant_id: string; sku: string | null; product_title: string; category_name: string | null;
  scan_count: number; resolution_status: string; counted_quantity: number; snapshot_on_hand: number;
  current_on_hand: number; variance_quantity: number; unit_cost: number; variance_value: number;
  is_unvalued: boolean; has_interleaved_movements: boolean;
  interleaved_window?: { start: string; end: string } | null; contributing_lines: any[];
}

export async function computeStocktakeVariance(admin: SupabaseClient<any, any, any>, stocktakeId: string) {
  const { data: stocktake, error: stErr } = await (admin as any)
    .from("stocktakes")
    .select("*")
    .eq("id", stocktakeId)
    .single();

  if (stErr || !stocktake) throw new Error(stErr?.message || "Stocktake not found");

  const { data: lines } = await (admin as any)
    .from("stocktake_lines")
    .select("id, stocktake_id, variant_id, counter_id, counted_quantity, location_note, created_at, updated_at, users(name)")
    .eq("stocktake_id", stocktakeId);

  const lineIds = (lines ?? []).map((l: any) => l.id);

  const { data: snapshots, error: snapErr } = lineIds.length > 0
    ? await (admin as any)
        .from("stocktake_line_snapshots")
        .select("line_id, snapshot_on_hand, captured_at")
        .in("line_id", lineIds)
    : { data: [], error: null };

  if (snapErr) throw new Error(snapErr.message || "Failed to fetch snapshots");

  const snapshotMap = new Map<string, number>();
  (snapshots ?? []).forEach((s: any) => snapshotMap.set(s.line_id, Number(s.snapshot_on_hand)));

  for (const line of lines ?? []) {
    if (!snapshotMap.has(line.id)) {
      throw new Error(`Missing snapshot for stocktake line ${line.id} (variant ${line.variant_id})`);
    }
  }

  const { data: resolutions } = await (admin as any)
    .from("stocktake_resolutions")
    .select("*")
    .eq("stocktake_id", stocktakeId);

  const resolutionMap = new Map<string, any>();
  (resolutions ?? []).forEach((r: any) => resolutionMap.set(r.variant_id, r));

  const variantIds: string[] = Array.from(new Set<string>((lines ?? []).map((l: any) => String(l.variant_id))));

  const { data: variants } = variantIds.length > 0
    ? await (admin as any)
        .from("product_variants")
        .select("id, sku, on_hand, products(title, categories(name))")
        .in("id", variantIds)
    : { data: [] };

  const variantMap = new Map<string, any>();
  (variants ?? []).forEach((v: any) => variantMap.set(v.id, v));

  const { data: costs } = variantIds.length > 0
    ? await (admin as any)
        .from("variant_costs")
        .select("variant_id, cost_price")
        .in("variant_id", variantIds)
    : { data: [] };

  const costMap = new Map<string, number>();
  (costs ?? []).forEach((c: any) => costMap.set(c.variant_id, Number(c.cost_price ?? 0)));

  // Interleaved movements check (R5)
  const { data: recentMovements } = variantIds.length > 0
    ? await (admin as any)
        .from("stock_movements")
        .select("id, variant_id, created_at")
        .in("variant_id", variantIds)
    : { data: [] };

  const linesByVariant = new Map<string, any[]>();
  (lines ?? []).forEach((l: any) => {
    const list = linesByVariant.get(l.variant_id) ?? [];
    list.push(l);
    linesByVariant.set(l.variant_id, list);
  });

  const items: StocktakeVarianceItem[] = [];

  for (const variantId of variantIds) {
    const vLines = linesByVariant.get(variantId) ?? [];
    const vInfo = variantMap.get(variantId);
    const unitCost = costMap.get(variantId) ?? 0;
    const currentOnHand = Number(vInfo?.on_hand ?? 0);
    const productTitle = vInfo?.products?.title ?? "Unknown Product";
    const categoryName = vInfo?.products?.categories?.name ?? null;

    const res = resolutionMap.get(variantId);

    // R5 / F2: Reconcile against chosen line snapshot if override, or latest snapshot otherwise
    const sortedLines = [...vLines].sort((a: any, b: any) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());
    const latestLine = sortedLines[0];
    const chosenLine = res?.resolution_type === "override" && res.chosen_line_id
      ? vLines.find((l: any) => l.id === res.chosen_line_id)
      : null;
    const effectiveLine = chosenLine ?? latestLine;
    const snapshotOnHand = effectiveLine ? snapshotMap.get(effectiveLine.id) : undefined;
    if (snapshotOnHand === undefined) {
      throw new Error(`Missing snapshot for stocktake line ${effectiveLine?.id} (variant ${variantId})`);
    }

    // R5: Interleaved movements check
    const timestamps = vLines.map((l: any) => new Date(String(l.created_at)).getTime());
    const earliestTime = Math.min(...timestamps), latestTime = Math.max(...timestamps);
    const hasInterleaved = earliestTime < latestTime && (recentMovements ?? []).some((m: any) => {
      const mTime = new Date(String(m.created_at)).getTime();
      return m.variant_id === variantId && mTime > earliestTime && mTime < latestTime;
    });

    let countedQuantity = 0, resolutionStatus = "single";

    const isStale = Boolean(res && (
      vLines.length !== Number(res.resolved_line_count) ||
      (vLines.length > 0 && Math.max(...vLines.map((l: any) => new Date(String(l.created_at)).getTime())) > new Date(String(res.resolved_latest_line_at)).getTime())
    ));

    if (res && !isStale) {
      countedQuantity = Number(res.resolved_quantity);
      resolutionStatus = res.resolution_type === "override" ? "override_resolved" : "sum_resolved";
    } else if (res && isStale) {
      // Resolution is stale: leave reading resolved_quantity, mark as needing re-resolution
      countedQuantity = Number(res.resolved_quantity);
      resolutionStatus = "unresolved_conflict";
    } else if (vLines.length === 1) {
      countedQuantity = Number(vLines[0].counted_quantity);
      resolutionStatus = "single";
    } else {
      // R3: Distinct location notes check
      const validNotes = vLines.map((l: any) => String(l.location_note ?? "").trim()).filter(Boolean);
      const isDistinctLocations = validNotes.length === vLines.length && new Set(validNotes).size === vLines.length;
      countedQuantity = vLines.reduce((acc, l) => acc + Number(l.counted_quantity), 0);
      resolutionStatus = isDistinctLocations ? "sum_defaulted" : "unresolved_conflict";
    }

    const varianceQty = Number((countedQuantity - snapshotOnHand).toFixed(3));
    const varianceVal = Number((varianceQty * unitCost).toFixed(2));
    const isUnvalued = unitCost <= 0;

    items.push({
      variant_id: variantId,
      sku: vInfo?.sku ?? null,
      product_title: productTitle,
      category_name: categoryName,
      scan_count: vLines.length,
      resolution_status: resolutionStatus,
      counted_quantity: countedQuantity,
      snapshot_on_hand: snapshotOnHand,
      current_on_hand: currentOnHand,
      variance_quantity: varianceQty,
      unit_cost: unitCost,
      variance_value: varianceVal,
      is_unvalued: isUnvalued,
      has_interleaved_movements: hasInterleaved,
      interleaved_window: earliestTime < latestTime ? {
        start: new Date(earliestTime).toISOString(), end: new Date(latestTime).toISOString(),
      } : null,
      contributing_lines: vLines.map((l) => ({
        id: l.id, stocktake_id: l.stocktake_id, variant_id: l.variant_id, counter_id: l.counter_id,
        counter_name: l.users?.name ?? null, counted_quantity: Number(l.counted_quantity),
        location_note: l.location_note ?? null, created_at: l.created_at, updated_at: l.updated_at,
      })),
    });
  }

  // Sort by ABS(variance_value) DESC
  items.sort((a, b) => Math.abs(b.variance_value) - Math.abs(a.variance_value));

  const { count: totalVariants } = await (admin as any)
    .from("product_variants")
    .select("id", { count: "exact", head: true });

  const totalStoreVariants = Number(totalVariants ?? 0);
  const uncountedVariants = Math.max(0, totalStoreVariants - items.length);

  let shrinkageValue = 0;
  let unvaluedShrinkageUnits = 0;
  let discrepantItems = 0;
  let unresolvedCount = 0;

  for (const it of items) {
    if (it.variance_quantity < 0) {
      if (it.unit_cost > 0) shrinkageValue += Math.abs(it.variance_value);
      else unvaluedShrinkageUnits += Math.abs(it.variance_quantity);
    }
    if (it.variance_quantity !== 0) discrepantItems++;
    if (it.resolution_status === "unresolved_conflict") unresolvedCount++;
  }

  return {
    stocktake, items,
    summary: {
      shrinkage_value: Number(shrinkageValue.toFixed(2)),
      unvalued_shrinkage_units: Number(unvaluedShrinkageUnits.toFixed(3)),
      total_items_counted: items.length, discrepant_items_count: discrepantItems,
      uncounted_variants_count: uncountedVariants, unresolved_conflicts_count: unresolvedCount,
    },
  };
}
