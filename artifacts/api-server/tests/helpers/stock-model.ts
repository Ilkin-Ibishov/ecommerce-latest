/**
 * Stock decrement model — simulates the behavior of the `decrement_stock_safe`
 * Postgres RPC function for property-based testing.
 *
 * This in-memory model allows PBT tests to verify invariants (stock never
 * goes negative, exact subtraction, zero-stock rejection) without requiring
 * a live database connection.
 */

export class StockModel {
  private stock: number;

  constructor(initialStock: number) {
    this.stock = initialStock;
  }

  decrement(qty: number): { ok: boolean; remaining: number } {
    if (qty > this.stock) {
      return { ok: false, remaining: this.stock };
    }
    this.stock -= qty;
    return { ok: true, remaining: this.stock };
  }

  get current(): number {
    return this.stock;
  }
}
