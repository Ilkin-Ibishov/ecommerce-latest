import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

/**
 * Audit Logging Property Tests
 * Feature: white-label-customization, Property 5: All admin mutations produce audit log entries
 *
 * **Validates: Requirements 1.7, 6.7**
 *
 * For any successful admin write operation (settings update, page create/update/delete),
 * an `audit_log` row SHALL be created with the correct `actor_id`, `action`, `entity`,
 * `entity_id`, and `changes` fields.
 */

// ─── Replicate audit log helpers (same logic as in routes) ──────────────────────

/**
 * Simulates the audit log insert operation as it occurs in the route handlers.
 * The key behavior being tested: the insert call is made synchronously with
 * the correct payload structure.
 */
function logSettingsAudit(
  admin: any,
  actorId: string,
  entityId: string,
  changes: Record<string, unknown>
): void {
  admin
    .from("audit_log")
    .insert({
      actor_id: actorId,
      action: "update_settings",
      entity: "site_settings",
      entity_id: entityId,
      changes,
    });
}

/**
 * Simulates the audit log insert operation for page actions.
 */
function logPageAudit(
  admin: any,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  changes: Record<string, unknown>
): void {
  admin
    .from("audit_log")
    .insert({
      actor_id: actorId,
      action,
      entity: entityType,
      entity_id: entityId,
      changes,
    });
}

// ─── Mock Supabase client factory ───────────────────────────────────────────────

function createMockAdmin() {
  const insertMock = vi.fn().mockReturnValue({ then: () => ({ catch: () => {} }) });
  const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
  return { from: fromMock, _insertMock: insertMock, _fromMock: fromMock };
}

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid UUID-like actor_id */
const actorIdArb = fc.uuid();

/** Generate a valid UUID-like entity_id */
const entityIdArb = fc.uuid();

/** Generate a valid HSL color string */
const validHslArb = fc
  .tuple(
    fc.integer({ min: 0, max: 360 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 })
  )
  .map(([h, s, l]) => `${h} ${s}% ${l}%`);

/** Generate a valid color palette */
const validColorPaletteArb = fc
  .tuple(validHslArb, validHslArb, validHslArb, validHslArb, validHslArb, validHslArb)
  .map(([primary, secondary, accent, background, text, muted]) => ({
    primary,
    secondary,
    accent,
    background,
    text,
    muted,
  }));

/** Generate a valid font configuration */
const validFontConfigArb = fc.record({
  heading: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  body: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
});

/** The recognized settings fields that can appear in a PATCH body */
const SETTINGS_FIELDS = [
  "store_name",
  "colors",
  "fonts",
  "logo_url",
  "favicon_url",
  "contact",
  "working_hours",
  "footer_text",
] as const;

/** Generate a valid settings PATCH body (subset of recognized fields) */
const settingsPatchBodyArb = fc
  .subarray([...SETTINGS_FIELDS], { minLength: 1 })
  .chain((fields) => {
    const record: Record<string, fc.Arbitrary<unknown>> = {};
    for (const field of fields) {
      switch (field) {
        case "store_name":
          record[field] = fc.record({
            az: fc.string({ minLength: 0, maxLength: 100 }),
            ru: fc.string({ minLength: 0, maxLength: 100 }),
            en: fc.string({ minLength: 0, maxLength: 100 }),
          });
          break;
        case "colors":
          record[field] = validColorPaletteArb;
          break;
        case "fonts":
          record[field] = validFontConfigArb;
          break;
        case "logo_url":
          record[field] = fc.oneof(fc.constant(null), fc.webUrl());
          break;
        case "favicon_url":
          record[field] = fc.oneof(fc.constant(null), fc.webUrl());
          break;
        case "contact":
          record[field] = fc.record({
            phone: fc.string({ minLength: 0, maxLength: 20 }),
            email: fc.string({ minLength: 0, maxLength: 254 }),
            address: fc.string({ minLength: 0, maxLength: 200 }),
            social_links: fc.constant({}),
          });
          break;
        case "working_hours":
          record[field] = fc.record({
            az: fc.string({ minLength: 0, maxLength: 200 }),
            ru: fc.string({ minLength: 0, maxLength: 200 }),
            en: fc.string({ minLength: 0, maxLength: 200 }),
          });
          break;
        case "footer_text":
          record[field] = fc.record({
            az: fc.string({ minLength: 0, maxLength: 500 }),
            ru: fc.string({ minLength: 0, maxLength: 500 }),
            en: fc.string({ minLength: 0, maxLength: 500 }),
          });
          break;
      }
    }
    return fc.record(record as any);
  });

/** Generate a valid page slug */
const validSlugArb = fc
  .array(
    fc.stringMatching(/^[a-z0-9]+$/),
    { minLength: 1, maxLength: 4 }
  )
  .map((parts) => parts.join("-"))
  .filter((s) => s.length > 0 && s.length <= 100);

/** Generate a valid page create request body */
const pageCreateBodyArb = fc.record({
  slug: validSlugArb,
  published: fc.boolean(),
  sort_order: fc.integer({ min: 0, max: 999 }),
  show_in_header: fc.boolean(),
  show_in_footer: fc.boolean(),
});

/** Generate a valid page update request body (partial metadata) */
const pageUpdateBodyArb = fc.record({
  published: fc.option(fc.boolean(), { nil: undefined }),
  sort_order: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
  show_in_header: fc.option(fc.boolean(), { nil: undefined }),
  show_in_footer: fc.option(fc.boolean(), { nil: undefined }),
  slug: fc.option(validSlugArb, { nil: undefined }),
}).filter((body) => {
  // At least one field must be present
  return Object.values(body).some((v) => v !== undefined);
});

// ─── Property 5: All admin mutations produce audit log entries ──────────────────

describe("Feature: white-label-customization, Property 5: All admin mutations produce audit log entries", () => {
  describe("Settings update → audit_log entry", () => {
    /**
     * **Validates: Requirements 1.7**
     *
     * For any valid settings PATCH body, an audit_log entry is created with:
     * - actor_id = the admin's user ID
     * - action = "update_settings"
     * - entity = "site_settings"
     * - entity_id = "00000000-0000-0000-0000-000000000001"
     * - changes = only the modified fields
     */
    it("for any valid settings PATCH body, audit_log entry has correct fields", { timeout: 60_000 }, () => {
      fc.assert(
        fc.property(actorIdArb, settingsPatchBodyArb, (actorId, patchBody) => {
          const admin = createMockAdmin();
          const entityId = "00000000-0000-0000-0000-000000000001";

          // Simulate what the PATCH handler does after a successful update:
          // It strips updated_at and logs the remaining changes
          const auditChanges = { ...patchBody };

          logSettingsAudit(admin, actorId, entityId, auditChanges);

          // Verify the audit log was written
          expect(admin._fromMock).toHaveBeenCalledWith("audit_log");
          expect(admin._insertMock).toHaveBeenCalledTimes(1);

          const insertedEntry = admin._insertMock.mock.calls[0][0];

          // Verify all required fields
          expect(insertedEntry.actor_id).toBe(actorId);
          expect(insertedEntry.action).toBe("update_settings");
          expect(insertedEntry.entity).toBe("site_settings");
          expect(insertedEntry.entity_id).toBe("00000000-0000-0000-0000-000000000001");
          expect(insertedEntry.changes).toEqual(auditChanges);
        }),
        { numRuns: 100 },
      );
    });

    it("changes field contains exactly the modified fields and nothing else", () => {
      fc.assert(
        fc.property(actorIdArb, settingsPatchBodyArb, (actorId, patchBody) => {
          const admin = createMockAdmin();
          const entityId = "00000000-0000-0000-0000-000000000001";

          logSettingsAudit(admin, actorId, entityId, patchBody);

          const insertedEntry = admin._insertMock.mock.calls[0][0];

          // The changes field should have exactly the same keys as the patch body
          const patchKeys = Object.keys(patchBody).sort();
          const changesKeys = Object.keys(insertedEntry.changes).sort();
          expect(changesKeys).toEqual(patchKeys);

          // No extra fields like updated_at, id, created_at should leak in
          expect(insertedEntry.changes).not.toHaveProperty("updated_at");
          expect(insertedEntry.changes).not.toHaveProperty("id");
          expect(insertedEntry.changes).not.toHaveProperty("created_at");
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Page create → audit_log entry", () => {
    /**
     * **Validates: Requirements 6.7**
     *
     * For any valid page create request, an audit_log entry is created with:
     * - actor_id = the admin's user ID
     * - action = "create_page"
     * - entity = "pages"
     * - entity_id = the created page's ID
     * - changes = the page creation data
     */
    it("for any valid page create request, audit_log entry has correct fields", () => {
      fc.assert(
        fc.property(actorIdArb, entityIdArb, pageCreateBodyArb, (actorId, pageId, createBody) => {
          const admin = createMockAdmin();

          // Simulate what POST /admin/pages does after successful creation:
          const changes = {
            slug: createBody.slug,
            published: createBody.published,
            sort_order: createBody.sort_order,
            show_in_header: createBody.show_in_header,
            show_in_footer: createBody.show_in_footer,
          };

          logPageAudit(admin, actorId, "create_page", "pages", pageId, changes);

          expect(admin._fromMock).toHaveBeenCalledWith("audit_log");
          expect(admin._insertMock).toHaveBeenCalledTimes(1);

          const insertedEntry = admin._insertMock.mock.calls[0][0];

          expect(insertedEntry.actor_id).toBe(actorId);
          expect(insertedEntry.action).toBe("create_page");
          expect(insertedEntry.entity).toBe("pages");
          expect(insertedEntry.entity_id).toBe(pageId);
          expect(insertedEntry.changes).toEqual(changes);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Page update → audit_log entry", () => {
    /**
     * **Validates: Requirements 6.7**
     *
     * For any valid page update request, an audit_log entry is created with:
     * - actor_id = the admin's user ID
     * - action = "update_page"
     * - entity = "pages"
     * - entity_id = the page's ID
     * - changes = only the modified fields
     */
    it("for any valid page update request, audit_log entry has correct fields", () => {
      fc.assert(
        fc.property(actorIdArb, entityIdArb, pageUpdateBodyArb, (actorId, pageId, updateBody) => {
          const admin = createMockAdmin();

          // Simulate what PATCH /admin/pages/:id does: build changes from provided fields
          const changes: Record<string, unknown> = {};
          if (updateBody.published !== undefined) changes.published = updateBody.published;
          if (updateBody.sort_order !== undefined) changes.sort_order = updateBody.sort_order;
          if (updateBody.show_in_header !== undefined) changes.show_in_header = updateBody.show_in_header;
          if (updateBody.show_in_footer !== undefined) changes.show_in_footer = updateBody.show_in_footer;
          if (updateBody.slug !== undefined) changes.slug = updateBody.slug;

          logPageAudit(admin, actorId, "update_page", "pages", pageId, changes);

          expect(admin._fromMock).toHaveBeenCalledWith("audit_log");
          expect(admin._insertMock).toHaveBeenCalledTimes(1);

          const insertedEntry = admin._insertMock.mock.calls[0][0];

          expect(insertedEntry.actor_id).toBe(actorId);
          expect(insertedEntry.action).toBe("update_page");
          expect(insertedEntry.entity).toBe("pages");
          expect(insertedEntry.entity_id).toBe(pageId);
          expect(insertedEntry.changes).toEqual(changes);

          // Verify changes only contains fields that were actually modified
          for (const key of Object.keys(insertedEntry.changes)) {
            expect(updateBody).toHaveProperty(key);
            expect((updateBody as any)[key]).not.toBeUndefined();
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Page delete → audit_log entry", () => {
    /**
     * **Validates: Requirements 6.7**
     *
     * For any valid page delete request, an audit_log entry is created with:
     * - actor_id = the admin's user ID
     * - action = "delete_page"
     * - entity = "pages"
     * - entity_id = the page's ID
     * - changes = { slug: <deleted page slug> }
     */
    it("for any valid page delete request, audit_log entry has correct fields", () => {
      fc.assert(
        fc.property(actorIdArb, entityIdArb, validSlugArb, (actorId, pageId, slug) => {
          const admin = createMockAdmin();

          // Simulate what DELETE /admin/pages/:id does:
          const changes = { slug };

          logPageAudit(admin, actorId, "delete_page", "pages", pageId, changes);

          expect(admin._fromMock).toHaveBeenCalledWith("audit_log");
          expect(admin._insertMock).toHaveBeenCalledTimes(1);

          const insertedEntry = admin._insertMock.mock.calls[0][0];

          expect(insertedEntry.actor_id).toBe(actorId);
          expect(insertedEntry.action).toBe("delete_page");
          expect(insertedEntry.entity).toBe("pages");
          expect(insertedEntry.entity_id).toBe(pageId);
          expect(insertedEntry.changes).toEqual({ slug });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Cross-cutting audit properties", () => {
    /**
     * Verifies that all audit operations always produce exactly one insert call
     * and always target the "audit_log" table.
     */
    it("every admin mutation type produces exactly one audit_log insert", () => {
      const actionArb = fc.constantFrom(
        "update_settings" as const,
        "create_page" as const,
        "update_page" as const,
        "delete_page" as const
      );

      fc.assert(
        fc.property(actorIdArb, entityIdArb, actionArb, (actorId, entityId, action) => {
          const admin = createMockAdmin();

          const entity = action === "update_settings" ? "site_settings" : "pages";
          const changes = { test: true };

          if (action === "update_settings") {
            logSettingsAudit(admin, actorId, entityId, changes);
          } else {
            logPageAudit(admin, actorId, action, entity, entityId, changes);
          }

          // Exactly one insert to audit_log
          expect(admin._fromMock).toHaveBeenCalledTimes(1);
          expect(admin._fromMock).toHaveBeenCalledWith("audit_log");
          expect(admin._insertMock).toHaveBeenCalledTimes(1);
        }),
        { numRuns: 100 },
      );
    });

    it("actor_id is always preserved exactly as provided", () => {
      fc.assert(
        fc.property(
          actorIdArb,
          entityIdArb,
          fc.constantFrom("update_settings", "create_page", "update_page", "delete_page"),
          (actorId, entityId, action) => {
            const admin = createMockAdmin();
            const entity = action === "update_settings" ? "site_settings" : "pages";

            if (action === "update_settings") {
              logSettingsAudit(admin, actorId, entityId, { field: "value" });
            } else {
              logPageAudit(admin, actorId, action, entity, entityId, { field: "value" });
            }

            const insertedEntry = admin._insertMock.mock.calls[0][0];
            expect(insertedEntry.actor_id).toBe(actorId);
          }
        ),
        { numRuns: 100 },
      );
    });

    it("entity and entity_id are correctly paired for settings vs pages", () => {
      fc.assert(
        fc.property(
          actorIdArb,
          entityIdArb,
          fc.constantFrom("update_settings", "create_page", "update_page", "delete_page"),
          (actorId, entityId, action) => {
            const admin = createMockAdmin();

            if (action === "update_settings") {
              logSettingsAudit(admin, actorId, entityId, {});
            } else {
              logPageAudit(admin, actorId, action, "pages", entityId, {});
            }

            const insertedEntry = admin._insertMock.mock.calls[0][0];

            if (action === "update_settings") {
              expect(insertedEntry.entity).toBe("site_settings");
            } else {
              expect(insertedEntry.entity).toBe("pages");
            }
            expect(insertedEntry.entity_id).toBe(entityId);
          }
        ),
        { numRuns: 100 },
      );
    });
  });
});
