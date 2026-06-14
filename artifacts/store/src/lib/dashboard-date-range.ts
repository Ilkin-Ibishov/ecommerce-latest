// ─── Date range presets ───────────────────────────────────────
export type DatePreset = "7d" | "30d" | "thisMonth" | "90d";

export interface DateRange {
  from: Date;
  to: Date;
  compareFrom: Date;
  compareTo: Date;
  label: string;
}

export function getDateRange(preset: DatePreset): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  switch (preset) {
    case "7d": {
      const from = new Date(today.getTime() - 6 * 86400000); from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 7 * 86400000);
      return { from, to: today, compareFrom, compareTo: new Date(from.getTime() - 1), label: "Last 7 days" };
    }
    case "30d": {
      const from = new Date(today.getTime() - 29 * 86400000); from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 30 * 86400000);
      return { from, to: today, compareFrom, compareTo: new Date(from.getTime() - 1), label: "Last 30 days" };
    }
    case "90d": {
      const from = new Date(today.getTime() - 89 * 86400000); from.setHours(0, 0, 0, 0);
      const compareFrom = new Date(from.getTime() - 90 * 86400000);
      return { from, to: today, compareFrom, compareTo: new Date(from.getTime() - 1), label: "Last 90 days" };
    }
    case "thisMonth":
    default: {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const compareFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const compareTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { from, to: today, compareFrom, compareTo, label: "This month" };
    }
  }
}
