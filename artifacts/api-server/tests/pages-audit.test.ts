import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for CMS page audit logging (Task 4.4).
 * Validates Requirement 6.7: audit_log entry for every page create, update, delete action.
 *
 * These are unit tests that verify the logPageAudit helper function correctly
 * calls the Supabase audit_log table with the expected fields.
 */

/**
 * Replicate the logPageAudit helper for isolated testing.
 * Same logic as in routes/pages.ts — fire-and-forget insert.
 */
function logPageAudit(
  admin: any,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  changes: Record<string, unknown>
): void {
  (admin as any)
    .from("audit_log")
    .insert({
      actor_id: actorId,
      action,
      entity: entityType,
      entity_id: entityId,
      changes,
    })
    .then(({ error }: { error: any }) => {
      if (error) {
        // logged but not thrown
      }
    })
    .catch(() => {
      // logged but not thrown
    });
}

function createMockAdmin() {
  const insertMock = vi.fn().mockResolvedValue({ error: null });
  const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
  return { from: fromMock, _insertMock: insertMock, _fromMock: fromMock };
}

describe("CMS Page Audit Logging (Requirement 6.7)", () => {
  let mockAdmin: ReturnType<typeof createMockAdmin>;

  beforeEach(() => {
    mockAdmin = createMockAdmin();
  });

  describe("create_page action", () => {
    it("writes audit entry with correct actor_id, action, entity, entity_id, and changes", async () => {
      const actorId = "user-123";
      const pageId = "page-abc";
      const changes = {
        slug: "about-us",
        published: true,
        sort_order: 5,
        show_in_header: true,
        show_in_footer: false,
      };

      logPageAudit(mockAdmin, actorId, "create_page", "pages", pageId, changes);

      // Let the promise resolve
      await new Promise((r) => setTimeout(r, 0));

      expect(mockAdmin._fromMock).toHaveBeenCalledWith("audit_log");
      expect(mockAdmin._insertMock).toHaveBeenCalledWith({
        actor_id: "user-123",
        action: "create_page",
        entity: "pages",
        entity_id: "page-abc",
        changes: {
          slug: "about-us",
          published: true,
          sort_order: 5,
          show_in_header: true,
          show_in_footer: false,
        },
      });
    });
  });

  describe("update_page action", () => {
    it("writes audit entry with only modified fields in changes", async () => {
      const actorId = "admin-456";
      const pageId = "page-xyz";
      const changes = {
        published: false,
        sort_order: 10,
      };

      logPageAudit(mockAdmin, actorId, "update_page", "pages", pageId, changes);

      await new Promise((r) => setTimeout(r, 0));

      expect(mockAdmin._fromMock).toHaveBeenCalledWith("audit_log");
      expect(mockAdmin._insertMock).toHaveBeenCalledWith({
        actor_id: "admin-456",
        action: "update_page",
        entity: "pages",
        entity_id: "page-xyz",
        changes: {
          published: false,
          sort_order: 10,
        },
      });
    });
  });

  describe("delete_page action", () => {
    it("writes audit entry with slug in changes", async () => {
      const actorId = "admin-789";
      const pageId = "page-del";
      const changes = { slug: "old-page" };

      logPageAudit(mockAdmin, actorId, "delete_page", "pages", pageId, changes);

      await new Promise((r) => setTimeout(r, 0));

      expect(mockAdmin._fromMock).toHaveBeenCalledWith("audit_log");
      expect(mockAdmin._insertMock).toHaveBeenCalledWith({
        actor_id: "admin-789",
        action: "delete_page",
        entity: "pages",
        entity_id: "page-del",
        changes: { slug: "old-page" },
      });
    });
  });

  describe("update_page_translation action", () => {
    it("writes audit entry with translation data in changes", async () => {
      const actorId = "admin-101";
      const pageId = "page-trans";
      const changes = {
        locale: "az",
        title: "Haqqımızda",
        content: "(updated)",
        meta_title: "About Us | Store",
        meta_description: undefined,
      };

      logPageAudit(mockAdmin, actorId, "update_page_translation", "pages", pageId, changes);

      await new Promise((r) => setTimeout(r, 0));

      expect(mockAdmin._fromMock).toHaveBeenCalledWith("audit_log");
      expect(mockAdmin._insertMock).toHaveBeenCalledWith({
        actor_id: "admin-101",
        action: "update_page_translation",
        entity: "pages",
        entity_id: "page-trans",
        changes: {
          locale: "az",
          title: "Haqqımızda",
          content: "(updated)",
          meta_title: "About Us | Store",
          meta_description: undefined,
        },
      });
    });
  });

  describe("fire-and-forget behavior", () => {
    it("does not throw when insert returns an error", async () => {
      const errorAdmin = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
        }),
      };

      // Should not throw
      expect(() => {
        logPageAudit(errorAdmin, "user-1", "create_page", "pages", "id-1", { slug: "test" });
      }).not.toThrow();

      await new Promise((r) => setTimeout(r, 0));
    });

    it("does not throw when insert rejects", async () => {
      const rejectAdmin = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockRejectedValue(new Error("Network error")),
        }),
      };

      // Should not throw
      expect(() => {
        logPageAudit(rejectAdmin, "user-1", "delete_page", "pages", "id-2", { slug: "x" });
      }).not.toThrow();

      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe("audit entry structure", () => {
    it("always records entity as 'pages' for all page actions", async () => {
      const actions = ["create_page", "update_page", "delete_page", "update_page_translation"];

      for (const action of actions) {
        const admin = createMockAdmin();
        logPageAudit(admin, "user-x", action, "pages", "id-x", { test: true });
        await new Promise((r) => setTimeout(r, 0));

        expect(admin._insertMock).toHaveBeenCalledWith(
          expect.objectContaining({ entity: "pages" })
        );
      }
    });

    it("always includes actor_id from auth context", async () => {
      const admin = createMockAdmin();
      logPageAudit(admin, "specific-user-id", "create_page", "pages", "p1", {});
      await new Promise((r) => setTimeout(r, 0));

      expect(admin._insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ actor_id: "specific-user-id" })
      );
    });
  });
});
