import { describe, it, expect } from "vitest";

interface ReorderItem {
  variant_id: string;
  product_id: string;
  product_title: string;
  variant_sku: string;
  supplier_name: string;
  supplier_contact: string | null;
  available_quantity: number;
  units_sold_window: number;
  sales_count: number;
  velocity: number;
  days_of_cover: number | null;
  suggested_qty: number | null;
  has_enough_data: boolean;
}

function groupReorderItems(items: ReorderItem[]) {
  const map = new Map<string, { name: string; contact: string | null; items: ReorderItem[] }>();
  for (const item of items) {
    const key = item.supplier_name || "Unassigned";
    const group = map.get(key) ?? { name: key, contact: item.supplier_contact || null, items: [] };
    group.items.push(item);
    map.set(key, group);
  }
  return Array.from(map.values());
}

function filterDeadStockProducts(products: { id: string }[], deadStockVariants: { product_id: string }[]) {
  const deadSet = new Set(deadStockVariants.map((d) => d.product_id));
  return products.filter((p) => deadSet.has(p.id));
}

function filterLowStockProducts(
  products: { id: string; available_quantity: number }[],
  lowStockVariantProductIds: Set<string>,
) {
  return products.filter((p) => lowStockVariantProductIds.has(p.id) && p.available_quantity > 0);
}

function maskCommercialMetricsForStaff<T extends { unit_cost?: number; capital_tied_up?: number }>(
  item: T,
  isAdmin: boolean,
): Omit<T, "unit_cost" | "capital_tied_up"> | T {
  if (isAdmin) return item;
  const { unit_cost, capital_tied_up, ...safe } = item;
  return safe;
}

describe("M4 Frontend UI Logic & Stock Signals", () => {
  describe("Reorder Page Supplier Grouping", () => {
    it("groups reorder candidates by supplier and preserves unassigned fallback", () => {
      const items: ReorderItem[] = [
        {
          variant_id: "v1", product_id: "p1", product_title: "Phone Case", variant_sku: "CASE-01",
          supplier_name: "Supplier A", supplier_contact: "+994501112233", available_quantity: 2,
          units_sold_window: 10, sales_count: 5, velocity: 0.3571, days_of_cover: 5.6, suggested_qty: 20, has_enough_data: true,
        },
        {
          variant_id: "v2", product_id: "p2", product_title: "Charger", variant_sku: "CHG-01",
          supplier_name: "Supplier A", supplier_contact: "+994501112233", available_quantity: 0,
          units_sold_window: 14, sales_count: 7, velocity: 0.5, days_of_cover: 0, suggested_qty: 30, has_enough_data: true,
        },
        {
          variant_id: "v3", product_id: "p3", product_title: "Cable", variant_sku: "CBL-01",
          supplier_name: "", supplier_contact: null, available_quantity: 1,
          units_sold_window: 1, sales_count: 1, velocity: 0.0357, days_of_cover: 28, suggested_qty: null, has_enough_data: false,
        },
      ];

      const groups = groupReorderItems(items);
      expect(groups).toHaveLength(2);

      const supplierA = groups.find((g) => g.name === "Supplier A");
      expect(supplierA).toBeDefined();
      expect(supplierA?.contact).toBe("+994501112233");
      expect(supplierA?.items).toHaveLength(2);

      const unassigned = groups.find((g) => g.name === "Unassigned");
      expect(unassigned).toBeDefined();
      expect(unassigned?.items).toHaveLength(1);
      expect(unassigned?.items[0].has_enough_data).toBe(false);
      expect(unassigned?.items[0].suggested_qty).toBeNull();
    });
  });

  describe("Inventory Page Signals Filtering", () => {
    it("filters dead stock items matching the candidate product IDs", () => {
      const products = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
      const deadStock = [{ product_id: "p1" }, { product_id: "p3" }];

      const notSelling = filterDeadStockProducts(products, deadStock);
      expect(notSelling.map((p) => p.id)).toEqual(["p1", "p3"]);
    });

    it("filters low stock items matching database threshold signals", () => {
      const products = [
        { id: "p1", available_quantity: 3 },
        { id: "p2", available_quantity: 0 },
        { id: "p3", available_quantity: 15 },
      ];
      const lowStockIds = new Set(["p1"]);

      const low = filterLowStockProducts(products, lowStockIds);
      expect(low.map((p) => p.id)).toEqual(["p1"]);
    });

    it("does not fall back to < 10 when lowStockVariantProductIds is empty", () => {
      const products = [
        { id: "p1", available_quantity: 3 },
        { id: "p2", available_quantity: 0 },
        { id: "p3", available_quantity: 15 },
      ];
      const lowStockIds = new Set<string>();

      const low = filterLowStockProducts(products, lowStockIds);
      expect(low).toEqual([]);
    });
  });

  describe("Role-based Commercial Metric Masking", () => {
    it("strips unit_cost and capital_tied_up for staff users", () => {
      const item = {
        variant_id: "v1",
        on_hand: 10,
        unit_cost: 15.5,
        capital_tied_up: 155.0,
      };

      const staffView = maskCommercialMetricsForStaff(item, false);
      expect(staffView).not.toHaveProperty("unit_cost");
      expect(staffView).not.toHaveProperty("capital_tied_up");
      expect(staffView).toEqual({ variant_id: "v1", on_hand: 10 });

      const adminView = maskCommercialMetricsForStaff(item, true);
      expect(adminView).toHaveProperty("unit_cost", 15.5);
      expect(adminView).toHaveProperty("capital_tied_up", 155.0);
    });
  });
});
