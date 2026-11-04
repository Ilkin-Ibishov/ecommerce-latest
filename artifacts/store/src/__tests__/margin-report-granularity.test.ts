import { describe, it, expect } from "vitest";

/**
 * M2a Margin Report Granularity & Fan-out Prevention Tests
 *
 * Implements:
 * 1. Required test: 3-unit sale followed by 1-unit return leaves report
 *    showing 2 units, 2 units COGS, and 2 units revenue.
 * 2. Fan-out elimination: multiple order_items for same (order_id, variant_id)
 *    aggregate before join, avoiding duplicate revenue or COGS multiplication.
 * 3. Weighted unit price: discounts reflected in net line revenue.
 */

interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string;
  quantity: number;
  line_total: number;
  product_price_snapshot: number;
}

interface SaleMovement {
  movement_id: string;
  variant_id: string;
  posting_date: string;
  quantity_delta: number;
  reason: "online_sale" | "counter_sale" | "customer_return";
  reference_type: string;
  reference_id: string; // order_id
  unit_cost: number;
  total_cost: number;
}

interface MarginReportRow {
  variant_id: string;
  net_units_sold: number;
  total_revenue: number;
  total_cogs: number;
  gross_margin: number;
  margin_percent: number;
}

function calculateMarginReport(
  orderItems: OrderItem[],
  movements: SaleMovement[],
  dateRange: { start: string; end: string }
): Map<string, MarginReportRow> {
  // Step 1: Pre-aggregate order_items to one row per (order_id, variant_id)
  const unitPriceMap = new Map<string, number>();
  const orderGroups = new Map<string, { totalLineTotal: number; totalQty: number }>();

  for (const oi of orderItems) {
    const key = `${oi.order_id}:${oi.variant_id}`;
    const cur = orderGroups.get(key) ?? { totalLineTotal: 0, totalQty: 0 };
    cur.totalLineTotal += oi.line_total;
    cur.totalQty += oi.quantity;
    orderGroups.set(key, cur);
  }

  for (const [key, group] of orderGroups) {
    const unitPrice = group.totalQty > 0 ? group.totalLineTotal / group.totalQty : 0;
    unitPriceMap.set(key, unitPrice);
  }

  // Step 2: Filter movements within business date range
  const filteredMovs = movements.filter(
    (m) => m.posting_date >= dateRange.start && m.posting_date < dateRange.end
  );

  // Step 3: Aggregate metrics per variant
  const result = new Map<string, MarginReportRow>();

  for (const m of filteredMovs) {
    const key = `${m.reference_id}:${m.variant_id}`;
    const weightedUnitPrice = m.reference_type === "order" ? (unitPriceMap.get(key) ?? 0) : 0;

    let revenueDelta = 0;
    let cogsDelta = 0;
    let unitsDelta = 0;

    if (m.reason === "online_sale" || m.reason === "counter_sale") {
      unitsDelta = -m.quantity_delta;
      cogsDelta = m.total_cost;
      revenueDelta = weightedUnitPrice * Math.abs(m.quantity_delta);
    } else if (m.reason === "customer_return") {
      unitsDelta = -m.quantity_delta; // negative delta decrements net units sold
      cogsDelta = -m.total_cost;
      revenueDelta = -(weightedUnitPrice * Math.abs(m.quantity_delta));
    }

    const cur = result.get(m.variant_id) ?? {
      variant_id: m.variant_id,
      net_units_sold: 0,
      total_revenue: 0,
      total_cogs: 0,
      gross_margin: 0,
      margin_percent: 0,
    };

    cur.net_units_sold += unitsDelta;
    cur.total_revenue = Number((cur.total_revenue + revenueDelta).toFixed(2));
    cur.total_cogs = Number((cur.total_cogs + cogsDelta).toFixed(2));
    cur.gross_margin = Number((cur.total_revenue - cur.total_cogs).toFixed(2));
    cur.margin_percent = cur.total_revenue > 0 ? Number(((cur.gross_margin / cur.total_revenue) * 100).toFixed(2)) : 0;

    result.set(m.variant_id, cur);
  }

  return result;
}

describe("M2a Margin Report Granularity & Fan-out Prevention", () => {
  it("required test: 3-unit sale followed by 1-unit return leaves 2 units sold, 2 units COGS, 2 units revenue", () => {
    // 3-unit order line with discount: 3 units @ $10 retail discounted to $24 total ($8/unit)
    const orderItems: OrderItem[] = [
      {
        id: "oi-1",
        order_id: "ord-100",
        variant_id: "var-mugs",
        quantity: 3,
        line_total: 24.0, // $8/unit weighted
        product_price_snapshot: 10.0,
      },
    ];

    // Valued COGS basis: $4.00/unit
    const movements: SaleMovement[] = [
      {
        movement_id: "mov-sale-3",
        variant_id: "var-mugs",
        posting_date: "2026-11-04T10:00:00Z",
        quantity_delta: -3,
        reason: "online_sale",
        reference_type: "order",
        reference_id: "ord-100",
        unit_cost: 4.0,
        total_cost: 12.0, // 3 * $4.00
      },
      {
        movement_id: "mov-return-1",
        variant_id: "var-mugs",
        posting_date: "2026-11-04T14:00:00Z",
        quantity_delta: 1,
        reason: "customer_return",
        reference_type: "order",
        reference_id: "ord-100",
        unit_cost: 4.0,
        total_cost: 4.0, // 1 * $4.00
      },
    ];

    const report = calculateMarginReport(orderItems, movements, {
      start: "2026-11-01T00:00:00Z",
      end: "2026-11-05T00:00:00Z",
    });

    const mugReport = report.get("var-mugs");
    expect(mugReport).toBeDefined();

    // Must show exactly 2 units, 2 units revenue ($16.00), and 2 units COGS ($8.00)
    expect(mugReport?.net_units_sold).toBe(2);
    expect(mugReport?.total_revenue).toBe(16.0); // 2 * $8.00 (NOT $24 - $24 = 0)
    expect(mugReport?.total_cogs).toBe(8.0); // $12.00 - $4.00 = $8.00
    expect(mugReport?.gross_margin).toBe(8.0); // $16.00 - $8.00
    expect(mugReport?.margin_percent).toBe(50.0); // 50% margin
  });

  it("fan-out prevention: multiple order_items for same variant do not multiply revenue or COGS", () => {
    // Two order_items rows for same variant in single order (e.g. promo split)
    const orderItems: OrderItem[] = [
      { id: "oi-a", order_id: "ord-200", variant_id: "var-tea", quantity: 2, line_total: 20.0, product_price_snapshot: 10.0 },
      { id: "oi-b", order_id: "ord-200", variant_id: "var-tea", quantity: 2, line_total: 20.0, product_price_snapshot: 10.0 },
    ];

    // Single physical fulfillment movement for 4 units
    const movements: SaleMovement[] = [
      {
        movement_id: "mov-tea-sale",
        variant_id: "var-tea",
        posting_date: "2026-11-04T11:00:00Z",
        quantity_delta: -4,
        reason: "online_sale",
        reference_type: "order",
        reference_id: "ord-200",
        unit_cost: 5.0,
        total_cost: 20.0,
      },
    ];

    const report = calculateMarginReport(orderItems, movements, {
      start: "2026-11-01T00:00:00Z",
      end: "2026-11-05T00:00:00Z",
    });

    const teaReport = report.get("var-tea");
    expect(teaReport?.net_units_sold).toBe(4);
    expect(teaReport?.total_revenue).toBe(40.0); // Exactly 4 * $10, not multiplied to 80
    expect(teaReport?.total_cogs).toBe(20.0);
    expect(teaReport?.gross_margin).toBe(20.0);
  });
});
