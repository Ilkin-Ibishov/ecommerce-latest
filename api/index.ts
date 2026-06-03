/**
 * Vercel Serverless Function adapter for the Express API.
 *
 * Uses dynamic import to load the ESM bundle from the Express app.
 * All /api/* routes are handled here.
 */

let app;

export default async function handler(req, res) {
  if (!app) {
    const mod = await import("../artifacts/api-server/dist/app.mjs");
    app = mod.default;
  }
  return app(req, res);
}
