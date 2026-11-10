# Local dev environment (Windows)

Verified 2026-11-06 getting `artifacts/api-server` and `artifacts/store` running together
against a real Supabase project from a fresh worktree on Windows.

## `pnpm run dev` scripts don't work from this harness's shell

`artifacts/api-server`'s `dev` script is `export NODE_ENV=development && pnpm run build && pnpm run start`.
`export` is bash syntax; it fails with `'export' is not recognized...` under the shell the preview
tool launches processes with. Don't fix this in `package.json` for a one-off — just build once
(`pnpm run build` inside `artifacts/api-server`) and launch `start` directly instead of `dev`.

## Neither server loads `.env` on its own

Nothing in `artifacts/api-server` or `artifacts/store` calls `dotenv.config()` (the `dotenv`
package is a dependency but unused), and Vite does not inject a package's `.env` into
`vite.config.ts`'s own `process.env` unless the config calls `loadEnv` (it doesn't here — the proxy
target line reads `process.env.VITE_API_PROXY_TARGET` directly).

Fix used: launch both with Node's built-in `--env-file=<path>` flag instead of going through the
`pnpm run <script>` wrapper, e.g.:

- API: `node --env-file=artifacts/api-server/.env --enable-source-maps artifacts/api-server/dist/index.mjs`
- Store: `node --env-file=artifacts/store/.env artifacts/store/node_modules/vite/bin/vite.js --config artifacts/store/vite.config.ts --host 0.0.0.0`

Both commands run from the repo root; paths in `--env-file` and the script argument are relative
to wherever the launcher's cwd actually is, so use absolute-from-repo-root paths to avoid ambiguity.

## `@tailwindcss/oxide` has no Windows native binding after a plain `pnpm install`

Vite's config load fails with `Cannot find native binding` from
`@tailwindcss/oxide/index.js` even though `@tailwindcss+oxide@4.3.0` is present in
`node_modules/.pnpm` — the `win32-x64-msvc` optional-dependency variant just isn't there.

Fix used: `pnpm add -D @tailwindcss/oxide-win32-x64-msvc -w` from the repo root. This pulled in
`^4.3.5` (slightly newer than the `4.3.0` the rest of the tree uses) and added it as a root
`devDependency` — that's a local workaround, not something to commit. If this needs to be a
permanent fix, it belongs as a proper `optionalDependencies` entry pinned to match, not an ad hoc
`-D` add.

## Port 5000 is frequently already taken

The API server's `.env` sets `PORT=5000`, but the preview tooling silently reassigns to 5001 (or
whatever's free) when 5000 is occupied — which is common with other sessions/worktrees running
concurrently. When that happens, update the store's `VITE_API_PROXY_TARGET` to match the actual
port the API server logged (`"Server listening" port: ...`), not the configured one.
