import { describe, it, expect } from "vitest";

/**
 * F6 Test — variant_costs Lifecycle & Tolerant Read Resolution
 *
 * Validates:
 * 1. Default variant sync (product update) guarantees variant_costs row exists.
 * 2. When cost_price is updated via product update, variant_costs is updated/upserted.
 * 3. Variant update endpoint upserts variant_costs when called by admin.
 * 4. Read paths tolerate the absence of variant_costs (defaulting to 0).
 * 5. Cost price is hidden from staff in variant list responses.
 */

interface VariantCostsRow {
  variant_id: string;
  cost_price: number;
}

interface ProductVariantRow {
  id: string;
  product_id: string;
  sku: string | null;
  price: number;
  is_default: boolean;
}

interface VariantReadOutput {
  id: string;
  product_id: string;
  sku: string | null;
  price: number;
  cost_price?: number;
}

class InMemoryVariantStore {
  variants: Map<string, ProductVariantRow> = new Map();
  costs: Map<string, VariantCostsRow> = new Map();

  createProductWithDefaultVariant(productId: string, price: number, sku: string, costPrice?: number) {
    const variantId = `var-${productId}-default`;
    this.variants.set(variantId, {
      id: variantId,
      product_id: productId,
      sku,
      price,
      is_default: true,
    });
    this.costs.set(variantId, {
      variant_id: variantId,
      cost_price: typeof costPrice === "number" && costPrice >= 0 ? costPrice : 0,
    });
    return variantId;
  }

  // Simulates PATCH /admin/products/:id default variant sync logic
  syncDefaultVariantOnProductUpdate(productId: string, updates: { price?: number; sku?: string; cost_price?: number }) {
    const defaultVar = Array.from(this.variants.values()).find(
      (v) => v.product_id === productId && v.is_default
    );
    if (!defaultVar) return;

    if (updates.price !== undefined) defaultVar.price = updates.price;
    if (updates.sku !== undefined) defaultVar.sku = updates.sku;

    if (updates.cost_price !== undefined) {
      this.costs.set(defaultVar.id, {
        variant_id: defaultVar.id,
        cost_price: updates.cost_price >= 0 ? updates.cost_price : 0,
      });
    } else {
      // Guarantee lifecycle row exists even if cost_price was omitted in request
      if (!this.costs.has(defaultVar.id)) {
        this.costs.set(defaultVar.id, {
          variant_id: defaultVar.id,
          cost_price: 0,
        });
      }
    }
  }

  // Simulates PATCH /admin/variants/:id logic
  updateVariant(variantId: string, updates: { price?: number; cost_price?: number }, userRole: "admin" | "staff") {
    const variant = this.variants.get(variantId);
    if (!variant) throw new Error("Variant not found");

    if (updates.price !== undefined && userRole === "staff") {
      throw new Error("Staff are not permitted to change product prices");
    }
    if (updates.price !== undefined) variant.price = updates.price;

    if (userRole === "admin" && updates.cost_price !== undefined) {
      this.costs.set(variantId, {
        variant_id: variantId,
        cost_price: updates.cost_price >= 0 ? updates.cost_price : 0,
      });
    }
  }

  // Simulates GET /admin/products/:id/variants tolerant read
  getVariantsForProduct(productId: string, userRole: "admin" | "staff"): VariantReadOutput[] {
    const list = Array.from(this.variants.values()).filter((v) => v.product_id === productId);
    return list.map((v) => {
      const costEntry = this.costs.get(v.id);
      // Tolerates absence: falls back to 0
      const costPrice = userRole === "admin" ? (costEntry?.cost_price ?? 0) : undefined;
      return {
        id: v.id,
        product_id: v.product_id,
        sku: v.sku,
        price: v.price,
        ...(userRole === "admin" ? { cost_price: costPrice } : {}),
      };
    });
  }
}

describe("F6: variant_costs Lifecycle & Tolerant Read Resolution", () => {
  it("guarantees variant_costs existence on product update even if cost_price is omitted", () => {
    const store = new InMemoryVariantStore();
    // Simulate legacy product variant that had no cost row
    store.variants.set("var-legacy", {
      id: "var-legacy",
      product_id: "prod-1",
      sku: "LEG-001",
      price: 20,
      is_default: true,
    });
    expect(store.costs.has("var-legacy")).toBe(false);

    // Sync product without cost_price in payload
    store.syncDefaultVariantOnProductUpdate("prod-1", { price: 25 });

    expect(store.costs.has("var-legacy")).toBe(true);
    expect(store.costs.get("var-legacy")?.cost_price).toBe(0);
  });

  it("updates variant_costs on product update when cost_price is provided", () => {
    const store = new InMemoryVariantStore();
    store.createProductWithDefaultVariant("prod-2", 50, "SHIRT-M", 20);

    expect(store.costs.get("var-prod-2-default")?.cost_price).toBe(20);

    store.syncDefaultVariantOnProductUpdate("prod-2", { cost_price: 28.5 });
    expect(store.costs.get("var-prod-2-default")?.cost_price).toBe(28.5);
  });

  it("permits admin to update cost_price via variant update endpoint", () => {
    const store = new InMemoryVariantStore();
    const varId = store.createProductWithDefaultVariant("prod-3", 100, "MUG-01", 35);

    store.updateVariant(varId, { cost_price: 42.0 }, "admin");
    expect(store.costs.get(varId)?.cost_price).toBe(42.0);
  });

  it("tolerates missing variant_costs on read and defaults cost_price to 0 for admin", () => {
    const store = new InMemoryVariantStore();
    store.variants.set("var-nocost", {
      id: "var-nocost",
      product_id: "prod-4",
      sku: "NO-COST",
      price: 15,
      is_default: true,
    });
    // Deliberately do not insert into store.costs

    const read = store.getVariantsForProduct("prod-4", "admin");
    expect(read).toHaveLength(1);
    expect(read[0].cost_price).toBe(0);
  });

  it("omits cost_price entirely when variants are read by staff", () => {
    const store = new InMemoryVariantStore();
    store.createProductWithDefaultVariant("prod-5", 80, "DESK-1", 45);

    const staffRead = store.getVariantsForProduct("prod-5", "staff");
    expect(staffRead).toHaveLength(1);
    expect(staffRead[0]).not.toHaveProperty("cost_price");
  });
});
