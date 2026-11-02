/**
 * Stock & Movement Ledger Model — simulates the behavior of the `product_variants`
 * and `stock_movements` PostgreSQL tables, pairing triggers, and safety checks.
 *
 * Simulates:
 * - Append-only stock_movements ledger with delta tracking
 * - trg_apply_stock_movement trigger (raises ST001 on insufficient stock)
 * - trg_guard_variant_on_hand_update (raises 55000 on direct on_hand updates)
 * - Ledger sum invariant: on_hand === sum(movements.delta)
 */

export interface StockMovementRecord {
  id: string;
  variantId: string;
  delta: number;
  reason: string;
  createdAt: Date;
}

export class StockLedgerError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "StockLedgerError";
    this.code = code;
  }
}

export class StockModel {
  private stock: number;
  private variantId: string;
  private movements: StockMovementRecord[] = [];

  constructor(initialStock: number = 0, variantId: string = "var-1") {
    this.stock = initialStock;
    this.variantId = variantId;
    if (initialStock > 0) {
      this.movements.push({
        id: `mov-init-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        variantId: this.variantId,
        delta: initialStock,
        reason: "opening_balance",
        createdAt: new Date(),
      });
    }
  }

  /** Backwards-compatible decrement method for existing tests */
  decrement(qty: number): { ok: boolean; remaining: number; errorCode?: string } {
    try {
      this.applyMovement(-qty, "order_fulfillment");
      return { ok: true, remaining: this.stock };
    } catch (err) {
      const code = err instanceof StockLedgerError ? err.code : "UNKNOWN";
      return { ok: false, remaining: this.stock, errorCode: code };
    }
  }

  /**
   * Applies a stock movement through the ledger.
   * Simulates PostgreSQL trigger trg_apply_stock_movement.
   * Rejects if delta would cause stock to go below zero with SQLSTATE ST001.
   */
  applyMovement(
    delta: number,
    reason: string = "manual_adjustment"
  ): { ok: boolean; remaining: number; movement: StockMovementRecord } {
    if (this.stock + delta < 0) {
      throw new StockLedgerError(
        `Insufficient stock on hand for movement. On hand: ${this.stock}, requested delta: ${delta}`,
        "ST001"
      );
    }

    this.stock += delta;
    const record: StockMovementRecord = {
      id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      variantId: this.variantId,
      delta,
      reason,
      createdAt: new Date(),
    };
    this.movements.push(record);

    return { ok: true, remaining: this.stock, movement: record };
  }

  /**
   * Simulates direct write attempt to product_variants.on_hand.
   * trg_guard_variant_on_hand_update checks pg_trigger_depth() <= 1 and raises 55000.
   */
  directUpdateOnHand(_newOnHand: number): never {
    throw new StockLedgerError(
      "Direct updates to product_variants.on_hand are prohibited. Mutate stock via stock_movements ledger.",
      "55000"
    );
  }

  get current(): number {
    return this.stock;
  }

  get onHand(): number {
    return this.stock;
  }

  get ledgerSum(): number {
    return this.movements.reduce((acc, m) => acc + m.delta, 0);
  }

  get ledger(): readonly StockMovementRecord[] {
    return this.movements;
  }
}
