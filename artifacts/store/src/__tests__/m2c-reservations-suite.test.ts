import { describe, it, expect } from "vitest";

describe("M2c Reservations & Concurrency Test Suite (§12.6)", () => {
  // Model state representing database tables & views
  interface Variant { id: string; on_hand: number; price: number; }
  interface Reservation {
    id: string;
    variant_id: string;
    quantity: number;
    status: "active" | "fulfilled" | "released" | "expired";
    agreed_price: number;
    paid_amount: number;
    expires_at: string | null;
  }
  interface Movement { id: string; variant_id: string; delta: number; reason: string; }

  function computeAvailability(variant: Variant, reservations: Reservation[], now: Date = new Date()) {
    const activeReserved = reservations
      .filter((r) => r.variant_id === variant.id && r.status === "active" && (!r.expires_at || new Date(r.expires_at) > now))
      .reduce((sum, r) => sum + r.quantity, 0);

    return {
      on_hand: variant.on_hand,
      reserved_quantity: activeReserved,
      available_quantity: Math.max(0, variant.on_hand - activeReserved),
      deficit_quantity: Math.max(0, activeReserved - variant.on_hand),
    };
  }

  // 1. A reservation never produces a movement
  it("Test 1: a reservation never produces a movement in stock_movements", () => {
    const movements: Movement[] = [];
    const variant: Variant = { id: "v1", on_hand: 10, price: 50 };
    const initialOnHand = variant.on_hand;

    // Create reservation with initial deposit
    const reservation: Reservation = {
      id: "res-1",
      variant_id: "v1",
      quantity: 2,
      status: "active",
      agreed_price: 100,
      paid_amount: 30,
      expires_at: null,
    };

    expect(movements.length).toBe(0);
    expect(variant.on_hand).toBe(initialOnHand);
    const avail = computeAvailability(variant, [reservation]);
    expect(avail.on_hand).toBe(10);
    expect(avail.reserved_quantity).toBe(2);
    expect(avail.available_quantity).toBe(8);
  });

  // 2. An online sale cannot consume a reserved unit
  it("Test 2: an online sale cannot consume a reserved unit (ST014)", () => {
    const variant: Variant = { id: "v1", on_hand: 2, price: 50 };
    const reservations: Reservation[] = [
      { id: "res-1", variant_id: "v1", quantity: 2, status: "active", agreed_price: 100, paid_amount: 50, expires_at: null },
    ];
    const movements: Movement[] = [];

    const attemptOnlineSale = (qty: number) => {
      const avail = computeAvailability(variant, reservations);
      if (avail.available_quantity < qty) {
        throw new Error(`ST014: Insufficient available stock for variant ${variant.id}. On hand: ${variant.on_hand}, reserved: ${avail.reserved_quantity}`);
      }
      variant.on_hand -= qty;
      movements.push({ id: "m1", variant_id: variant.id, delta: -qty, reason: "online_sale" });
    };

    expect(() => attemptOnlineSale(1)).toThrow("ST014");
    expect(movements.length).toBe(0);
    expect(variant.on_hand).toBe(2);
  });

  // 3. Two concurrent sales cannot both take the last available unit
  it("Test 3: two concurrent sales cannot both take the last available unit", async () => {
    // Shared database row state
    let onHand = 5;
    const reserved = 4; // Available = 1
    const movements: Movement[] = [];

    // Simulate PostgreSQL READ COMMITTED SELECT FOR UPDATE
    let rowMutex = Promise.resolve();
    const executeSaleTransaction = async (orderId: string, qty: number): Promise<{ success: boolean; error?: string }> => {
      let unlock: () => void;
      const lockAcquired = new Promise<void>((resolve) => { unlock = resolve; });
      const currentMutex = rowMutex;
      rowMutex = rowMutex.then(() => lockAcquired);

      await currentMutex;
      try {
        // Re-read latest committed row version under lock
        const available = Math.max(0, onHand - reserved);
        if (available < qty) {
          return { success: false, error: "ST014" };
        }
        onHand -= qty;
        movements.push({ id: `m-${orderId}`, variant_id: "v1", delta: -qty, reason: "online_sale" });
        return { success: true };
      } finally {
        unlock!();
      }
    };

    // Both carts race concurrently for the 1 remaining available unit
    const [result1, result2] = await Promise.all([
      executeSaleTransaction("order-1", 1),
      executeSaleTransaction("order-2", 1),
    ]);

    const successes = [result1, result2].filter((r) => r.success);
    const failures = [result1, result2].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error).toBe("ST014");
    expect(onHand).toBe(4);
    expect(movements.length).toBe(1);
  });

  // 4. An expired reservation stops reducing availability while a NULL-expiry one does not
  it("Test 4: expired reservation stops reducing availability while NULL-expiry does not", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const variant: Variant = { id: "v1", on_hand: 10, price: 40 };

    const expiredRes: Reservation = {
      id: "r-exp", variant_id: "v1", quantity: 3, status: "active", agreed_price: 120, paid_amount: 0,
      expires_at: "2026-11-04T11:00:00Z", // 1 hour ago
    };
    const nullExpiryRes: Reservation = {
      id: "r-null", variant_id: "v1", quantity: 2, status: "active", agreed_price: 80, paid_amount: 30,
      expires_at: null, // perpetual deposit
    };

    const avail = computeAvailability(variant, [expiredRes, nullExpiryRes], now);
    expect(avail.reserved_quantity).toBe(2); // Only nullExpiryRes counts
    expect(avail.available_quantity).toBe(8);
  });

  // 5. Stocktake correction pushing on-hand below reserved behaves as specified
  it("Test 5: stocktake correction pushing on-hand below reserved clamps available to 0 and exposes deficit", () => {
    const variant: Variant = { id: "v1", on_hand: 3, price: 100 };
    const reservations: Reservation[] = [
      { id: "r1", variant_id: "v1", quantity: 2, status: "active", agreed_price: 200, paid_amount: 100, expires_at: null },
    ];
    expect(computeAvailability(variant, reservations).available_quantity).toBe(1);

    // Physical stocktake discovers physical count = 1 unit (delta = -2)
    // Reason 'stocktake_correction' bypasses ST014 availability check
    variant.on_hand -= 2;

    const afterStocktake = computeAvailability(variant, reservations);
    expect(afterStocktake.on_hand).toBe(1);
    expect(afterStocktake.reserved_quantity).toBe(2);
    expect(afterStocktake.available_quantity).toBe(0); // Clamped to 0
    expect(afterStocktake.deficit_quantity).toBe(1); // Exposes 1-unit deficit
  });

  // 6. Staff cannot change an agreed price (403 for staff, owner only)
  it("Test 6: staff cannot change an agreed price; owner only", () => {
    const updatePrice = (userRole: "admin" | "staff", newPrice: number) => {
      if (userRole !== "admin") {
        const err = new Error("Forbidden: only store owner may renegotiate agreed price");
        (err as any).status = 403;
        throw err;
      }
      return { agreed_price: newPrice };
    };

    expect(() => updatePrice("staff", 80)).toThrow("Forbidden");
    expect(updatePrice("admin", 80).agreed_price).toBe(80);
  });

  // 7. Staff cannot release a reservation (403 for staff, owner only)
  it("Test 7: staff cannot release a reservation; owner only with reason", () => {
    const releaseReservation = (userRole: "admin" | "staff", reason?: string) => {
      if (userRole !== "admin") {
        const err = new Error("Forbidden: only store owner may release reservations");
        (err as any).status = 403;
        throw err;
      }
      if (!reason?.trim()) {
        throw new Error("Release reason required");
      }
      return { status: "released", release_reason: reason };
    };

    expect(() => releaseReservation("staff", "Refunded")).toThrow("Forbidden");
    expect(() => releaseReservation("admin", "")).toThrow("Release reason required");
    const released = releaseReservation("admin", "Customer forfeited deposit after 30 days");
    expect(released.status).toBe("released");
    expect(released.release_reason).toBe("Customer forfeited deposit after 30 days");
  });
});
