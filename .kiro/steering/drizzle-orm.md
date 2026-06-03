---
inclusion: fileMatch
fileMatchPattern: "**/db/**,**/schema/**,**/drizzle*"
---

# Drizzle ORM Patterns

## Schema Location

Each table goes in its own file under `lib/db/src/schema/`. Re-export from `lib/db/src/schema/index.ts`.

## Model Pattern

Every model file defines: the Drizzle table, an insert schema, and derived types.

```typescript
import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const todosTable = pgTable("todos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTodoSchema = createInsertSchema(todosTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTodo = z.infer<typeof insertTodoSchema>;
export type Todo = typeof todosTable.$inferSelect;
```

## Importing

```typescript
import { db } from "@workspace/db";
import { todosTable } from "@workspace/db";
```

## Push Commands

```bash
pnpm --filter @workspace/db run push
# If column conflicts:
pnpm --filter @workspace/db run push-force
```

## Pitfalls

- Array columns: `text("tags").array()` — call `.array()` as a method, not `array(text(...))`
- Date fields MUST use `{ withTimezone: true }` for timestamptz
- Do not edit `drizzle.config.ts` unless absolutely necessary
