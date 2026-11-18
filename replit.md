# Replit agent notes

This file is read by Replit's agent. The project's rules, stack and commands live in
[`AGENTS.md`](AGENTS.md); current state in [`docs/STATUS.md`](docs/STATUS.md). Do not duplicate
them here.

The database is Supabase/Postgres with RLS; schema changes are files in `supabase/migrations/`
(`supabase/AGENTS.md`). `lib/db` has a `drizzle-kit push` script, but no app code imports
`@workspace/db` — do not use it to change the schema. Never run migrations against a production
project.
