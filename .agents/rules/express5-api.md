---
trigger: glob
globs: artifacts/api-server/**/*
description: Express 5 routing, async handlers, Zod validation, logger, and HTTP status code standards
---

# Express 5 API Server Rules

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
