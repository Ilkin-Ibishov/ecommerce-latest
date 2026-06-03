---
inclusion: fileMatch
fileMatchPattern: "**/api-server/src/**"
---

# Express 5 Patterns & Pitfalls

## Express 5 Breaking Changes (vs Express 4)

- Wildcard routes need names: `app.get("/{*splat}", ...)` not `app.get("*", ...)`
- Optional params: `/todos{/:id}` not `/todos/:id?`
- `res.redirect('back')` removed — use `res.redirect(req.get('Referrer') || '/')`
- Async errors auto-forward — no need for `try/catch` + `next(err)` for 500s
- `req.params.id` is `string | string[]` — always parse:
  ```typescript
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  ```

## Route Handler Pattern

```typescript
import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Always annotate async handlers as Promise<void>
router.get("/things", async (req, res): Promise<void> => {
  // Validate with Zod from @workspace/api-zod
  const parsed = CreateThingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;  // Never: return res.status().json()
  }
  // ...
});

export default router;
```

## Logging

- NEVER use `console.log` in server code
- Use `req.log` in route handlers (includes request ID for correlation)
- Use singleton `logger` from `./lib/logger` for non-request code
- Structured context as first arg: `req.log.info({ userId }, "User created")`

## String Validation

```typescript
// WRONG — rejects empty string "" which may be valid
if (!content) { ... }

// CORRECT — check for null/undefined, allow empty string
if (content == null) { ... }
```

## Early Returns

```typescript
// CORRECT
res.status(404).json({ error: "Not found" });
return;

// WRONG — don't return the response
return res.status(404).json({ error: "Not found" });
```
