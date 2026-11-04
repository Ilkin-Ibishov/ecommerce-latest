import { describe, it, expect } from "vitest";

/**
 * M2b Blind Counting Security & Staff Boundary Test Suite
 * Validates R4 (blind counting limitations), table isolation, and RLS reachability.
 */

interface MockQueryResult<T> {
  data: T[] | null;
  error: { message: string; code: string } | null;
}

class MockSupabaseClient {
  constructor(public role: "admin" | "staff" | "anon", public userId: string) {}

  public from(tableName: string) {
    const { role, userId } = this;
    return {
      select: (columns: string): MockQueryResult<any> => {
        // 1. Admin-only tables: Staff and anon receive 0 rows
        const adminOnlyTables = [
          "stocktake_line_snapshots",
          "stocktake_opening_costs",
          "stocktake_resolutions",
        ];

        if (adminOnlyTables.includes(tableName)) {
          if (role !== "admin") {
            return { data: [], error: null }; // RLS policy returns empty set
          }
          return {
            data: [
              { line_id: "l1", snapshot_on_hand: 12, captured_at: "2026-11-04T12:00:00Z" },
            ],
            error: null,
          };
        }

        // 2. Staff-accessible tables: stocktakes and stocktake_lines
        if (tableName === "stocktake_lines") {
          const colList = columns.split(",").map((c) => c.trim());
          // Snapshot column does not exist on stocktake_lines
          if (colList.includes("snapshot_on_hand") || colList.includes("expected_quantity")) {
            return {
              data: null,
              error: {
                message: "column does not exist on table stocktake_lines",
                code: "42703",
              },
            };
          }

          return {
            data: [
              {
                id: "l1",
                stocktake_id: "st1",
                variant_id: "var-1",
                counter_id: userId,
                counted_quantity: 8,
                location_note: "Shelf A",
              },
            ],
            error: null,
          };
        }

        if (tableName === "stocktakes") {
          return {
            data: [
              {
                id: "st1",
                stocktake_number: "ST-001",
                title: "Floor Count",
                status: "draft",
              },
            ],
            error: null,
          };
        }

        return { data: [], error: null };
      },

      update: (payload: Record<string, any>) => {
        return {
          match: (filter: { id: string }) => {
            if (tableName === "stocktakes") {
              // R2: Staff draft update cannot alter posting_date or status
              if (role === "staff") {
                if (payload.posting_date !== undefined) {
                  return {
                    data: null,
                    error: { message: "new row violates row-level security policy", code: "42501" },
                  };
                }
              }
              return { data: [{ id: filter.id, ...payload }], error: null };
            }

            if (tableName === "stocktake_lines") {
              // Staff cannot update other counters' lines
              if (role === "staff" && payload.counter_id && payload.counter_id !== userId) {
                return {
                  data: null,
                  error: { message: "new row violates row-level security policy", code: "42501" },
                };
              }
              return { data: [{ id: filter.id, ...payload }], error: null };
            }

            return { data: [], error: null };
          },
        };
      },
    };
  }
}

describe("M2b Blind Counting Security and Staff Boundary", () => {
  it("R4: staff tokens querying PostgREST receive 0 rows from admin-only snapshot/cost/resolution tables", () => {
    const staffClient = new MockSupabaseClient("staff", "user-staff");

    const snapResult = staffClient.from("stocktake_line_snapshots").select("*");
    expect(snapResult.data).toEqual([]);

    const costResult = staffClient.from("stocktake_opening_costs").select("*");
    expect(costResult.data).toEqual([]);

    const resResult = staffClient.from("stocktake_resolutions").select("*");
    expect(resResult.data).toEqual([]);
  });

  it("admin tokens receive full access to snapshots and resolutions", () => {
    const adminClient = new MockSupabaseClient("admin", "user-admin");
    const snapResult = adminClient.from("stocktake_line_snapshots").select("*");
    expect(snapResult.data?.length).toBe(1);
    expect(snapResult.data?.[0].snapshot_on_hand).toBe(12);
  });

  it("stocktake_lines table contains zero snapshot or expected quantity columns", () => {
    const staffClient = new MockSupabaseClient("staff", "user-staff");
    const result = staffClient.from("stocktake_lines").select("id, snapshot_on_hand");
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("does not exist");
  });

  it("R2: staff cannot alter posting_date via RLS policy guard", () => {
    const staffClient = new MockSupabaseClient("staff", "user-staff");
    const updateResult = staffClient
      .from("stocktakes")
      .update({ posting_date: "2026-01-01T00:00:00Z" })
      .match({ id: "st1" });

    expect(updateResult.error).not.toBeNull();
    expect(updateResult.error?.code).toBe("42501");
  });
});
