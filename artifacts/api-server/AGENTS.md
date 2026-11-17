# API Server Agent Guidelines

This directory (`artifacts/api-server`) contains the Express 5 backend server.

## Key Stack & Conventions
- Express 5 with Node 24 and TypeScript
- Validation: Zod schemas from `@workspace/api-zod`
- Logging: Structured logger with correlation (`req.log`)
- Database: Supabase PostgreSQL with RLS and tenant scoping

## Core Rules for This Directory
1. **Express 5 Syntax**: Wildcard routes MUST be named (e.g. `app.get("/{*splat}", ...)`). Optional params use `/path{/:id}`.
2. **Handlers Return Void**: Annotate route handlers as `Promise<void>`. Use `res.status(...).json(...)` followed by `return;` on a new line.
3. **Zod Validation**: Validate incoming payloads at route boundary with `.safeParse()`. Never pass unvalidated `req.body` to internal functions.
4. **Structured Logging**: Never use `console.log`. Use `req.log.info({ ... }, "message")` inside routes.
5. **No Secrets**: Never log sensitive tokens, credentials, or customer PII.
6. **Invariants**: Any mutation of inventory or orders must preserve ledger append-only rules.

---

The detail, merged here from `.agents/rules/express5-api.md` on 2026-11-17 so that it loads
by scope instead of relying on a frontmatter trigger Claude Code does not read.

## Express 5 Specifics & Breaking Changes
- **Wildcard routes**: Express 5 requires named wildcards, e.g. `app.get("/{*splat}", ...)` (NOT `app.get("*", ...)`).
- **Optional parameters**: Use `/orders{/:id}` instead of `/orders/:id?`.
- **Async errors**: Express 5 automatically catches rejected promises in async route handlers. Do not write boilerplate `try { ... } catch (err) { next(err) }` just to forward 500s.
- **Param types**: `req.params.id` can be `string | string[]`. Always normalize:
  ```typescript
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  ```

## Route Handlers & Zod Validation
- Annotate async route handlers as `Promise<void>`:
  ```typescript
  router.post("/items", async (req, res): Promise<void> => { ... });
  ```
- Always validate request bodies using Zod schemas from `@workspace/api-zod`:
  ```typescript
  const parsed = CreateItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return; // NEVER: return res.status(400)...
  }
  ```
- **Early returns**: Send the response first, then `return;` on a separate line. Express handler types return `void`.

## Logging
- **Never use `console.log`** in server code.
- Inside route handlers: use `req.log` (preserves correlation IDs and request context):
  ```typescript
  req.log.info({ orderId }, "Order created successfully");
  ```
- Outside route handlers: use singleton `logger` from `./lib/logger`.

## Multi-Tenancy & Authorization
- Never write queries that omit the tenant/organization boundary.
- All database operations must respect Supabase RLS policies and tenant context.
- Never hardcode administrative or bypass tokens in API endpoints.
