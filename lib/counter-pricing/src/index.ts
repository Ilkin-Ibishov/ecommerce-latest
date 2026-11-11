/**
 * Counter-sale pricing (M3a design note Q3). Pure, no I/O: the counter screen uses it to
 * show the total before payment, and Express uses it to price the posting, so the cash
 * taken and the total recorded come from the same code. post_counter_sale checks the sums.
 *
 * Amounts in and out are AZN numbers; all arithmetic is in whole qəpik.
 */

export interface PricingLine {
  line_no: number;
  variant_id: string;
  quantity: number; // whole units
  charged_unit_price: number;
  bundle_id?: string | null;
}

export interface BundleDefinition {
  id: string;
  bundle_price: number | null; // null = a shortcut with no discount
  lines: { variant_id: string; quantity: number }[];
}

export interface PricedLine extends PricingLine {
  net_line_total: number;
}

export interface PricedSale {
  lines: PricedLine[];
  bundle_discount: number;
  owner_discount: number;
  total_amount: number;
}

const toQ = (azn: number) => Math.round(azn * 100);
const toAzn = (q: number) => q / 100;

/** Largest-remainder split of `amount` qəpik over `bases`. Each share ≤ its base. */
export function allocate(amount: number, bases: number[]): number[] {
  const sum = bases.reduce((a, b) => a + b, 0);
  if (amount <= 0 || sum <= 0) return bases.map(() => 0);
  const exact = bases.map((b) => (amount * b) / sum);
  const shares = exact.map(Math.floor);
  let left = amount - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

/**
 * Prices a cart. `ownerDiscount` must already be 0 for a staff session.
 * Throws if a line is tagged with an unknown bundle or a variant its bundle does not contain.
 */
export function priceCounterSale(
  lines: PricingLine[],
  bundles: BundleDefinition[],
  ownerDiscount: number,
): PricedSale {
  const gross = lines.map((l) => toQ(l.charged_unit_price) * l.quantity);
  const net1 = [...gross];
  let bundleDiscount = 0;

  // Stage 1: each bundle's discount, over that bundle's tagged lines.
  const byId = new Map(bundles.map((b) => [b.id, b]));
  const taggedIds = [...new Set(lines.map((l) => l.bundle_id).filter((id): id is string => !!id))];
  for (const id of taggedIds) {
    const def = byId.get(id);
    if (!def) throw new Error(`Unknown bundle ${id}`);
    const idx = lines.flatMap((l, i) => (l.bundle_id === id ? [i] : []));
    const taggedQty = new Map<string, number>();
    const price = new Map<string, number>();
    for (const i of idx) {
      const v = lines[i].variant_id;
      if (!def.lines.some((d) => d.variant_id === v)) throw new Error(`Variant ${v} is not in bundle ${id}`);
      taggedQty.set(v, (taggedQty.get(v) ?? 0) + lines[i].quantity);
      if (!price.has(v)) price.set(v, toQ(lines[i].charged_unit_price));
    }
    if (def.bundle_price === null) continue;
    const sets = Math.min(...def.lines.map((d) => Math.floor((taggedQty.get(d.variant_id) ?? 0) / d.quantity)));
    const setTotal = def.lines.reduce((s, d) => s + d.quantity * (price.get(d.variant_id) ?? 0), 0);
    const discount = sets * Math.max(0, setTotal - toQ(def.bundle_price));
    const shares = allocate(discount, idx.map((i) => gross[i]));
    idx.forEach((i, k) => (net1[i] -= shares[k]));
    bundleDiscount += discount;
  }

  // Stage 2: the owner's discount, over all lines, on what is left after bundles.
  const remaining = net1.reduce((a, b) => a + b, 0);
  const owner = Math.min(Math.max(0, toQ(ownerDiscount)), remaining);
  const ownerShares = allocate(owner, net1);
  const net = net1.map((n, i) => n - ownerShares[i]);

  return {
    lines: lines.map((l, i) => ({ ...l, net_line_total: toAzn(net[i]) })),
    bundle_discount: toAzn(bundleDiscount),
    owner_discount: toAzn(owner),
    total_amount: toAzn(net.reduce((a, b) => a + b, 0)),
  };
}
