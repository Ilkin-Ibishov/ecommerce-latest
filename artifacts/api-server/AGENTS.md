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
