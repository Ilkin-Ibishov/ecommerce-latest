import { describe, it, expect } from "vitest";
import { parseSignalSettings } from "../../../../artifacts/api-server/src/routes/admin/inventory-signals";

describe("parseSignalSettings", () => {
  it("uses provided values when all four rows are valid positive integers", () => {
    const rows = [
      { key: "dead_stock_days", value: "45" },
      { key: "reorder_target_days", value: "30" },
      { key: "reorder_velocity_window_days", value: "14" },
      { key: "reorder_min_sales", value: "5" },
    ];
    const settings = parseSignalSettings(rows);
    expect(settings).toEqual({
      deadStockDays: 45,
      reorderTargetDays: 30,
      reorderWindowDays: 14,
      reorderMinSales: 5,
    });
  });

  it("returns default values when rows list is empty", () => {
    const settings = parseSignalSettings([]);
    expect(settings).toEqual({
      deadStockDays: 90,
      reorderTargetDays: 60,
      reorderWindowDays: 28,
      reorderMinSales: 3,
    });
  });

  it("falls back to defaults for invalid values: '0', '-5', 'abc', '', '2.5'", () => {
    const invalidValues = ["0", "-5", "abc", "", "2.5"];

    for (const invalid of invalidValues) {
      const rows = [
        { key: "dead_stock_days", value: invalid },
        { key: "reorder_target_days", value: invalid },
        { key: "reorder_velocity_window_days", value: invalid },
        { key: "reorder_min_sales", value: invalid },
      ];
      const settings = parseSignalSettings(rows);
      expect(settings).toEqual({
        deadStockDays: 90,
        reorderTargetDays: 60,
        reorderWindowDays: 28,
        reorderMinSales: 3,
      });
    }
  });

  it("ignores unknown keys and keeps defaults for missing settings", () => {
    const rows = [
      { key: "unknown_signal_key", value: "100" },
      { key: "other_setting", value: "42" },
    ];
    const settings = parseSignalSettings(rows);
    expect(settings).toEqual({
      deadStockDays: 90,
      reorderTargetDays: 60,
      reorderWindowDays: 28,
      reorderMinSales: 3,
    });
  });
});
