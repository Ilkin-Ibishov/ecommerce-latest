import { describe, it, expect } from "vitest";
import { itemsForRole, markUnread } from "../../../api-server/src/lib/inbox";

describe("M4b inbox pure logic", () => {
  describe("itemsForRole", () => {
    it("returns all 5 needs_you keys for admin", () => {
      expect(itemsForRole("admin")).toEqual([
        "counter_needs_owner",
        "orders_pending",
        "low_stock",
        "holds_overdue",
        "reviews_pending",
      ]);
    });

    it("returns only low_stock and holds_overdue for staff", () => {
      expect(itemsForRole("staff")).toEqual([
        "low_stock",
        "holds_overdue",
      ]);
    });

    it("returns empty array for unknown or null roles", () => {
      expect(itemsForRole(null)).toEqual([]);
      expect(itemsForRole(undefined)).toEqual([]);
      expect(itemsForRole("shopper")).toEqual([]);
    });
  });

  describe("markUnread", () => {
    const userId = "admin-user-1";
    const otherId = "staff-user-2";
    const now = new Date("2026-11-18T12:00:00Z");

    it("handles missing marker (defaults cutoff to now - 14 days)", () => {
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();

      const events = [
        { time: tenDaysAgo, actor_id: otherId },
        { time: fifteenDaysAgo, actor_id: otherId },
      ];

      const result = markUnread(events, null, userId, now);
      expect(result[0].unread).toBe(true);
      expect(result[1].unread).toBe(false);
    });

    it("handles marker older than the window", () => {
      const marker = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const eighteenDaysAgo = new Date(now.getTime() - 18 * 24 * 60 * 60 * 1000).toISOString();
      const twentyTwoDaysAgo = new Date(now.getTime() - 22 * 24 * 60 * 60 * 1000).toISOString();

      const events = [
        { time: eighteenDaysAgo, actor_id: otherId },
        { time: twentyTwoDaysAgo, actor_id: otherId },
      ];

      const result = markUnread(events, marker, userId, now);
      expect(result[0].unread).toBe(true);
      expect(result[1].unread).toBe(false);
    });

    it("marks own actor as read even if newer than marker", () => {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const marker = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const events = [
        { time: oneHourAgo, actor_id: userId },
      ];

      const result = markUnread(events, marker, userId, now);
      expect(result[0].unread).toBe(false);
    });

    it("counts NULL actor as someone else (unread if newer than marker)", () => {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const marker = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const events = [
        { time: oneHourAgo, actor_id: null },
      ];

      const result = markUnread(events, marker, userId, now);
      expect(result[0].unread).toBe(true);
    });
  });
});
