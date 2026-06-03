/**
 * Vercel Serverless Function adapter for the Express API.
 *
 * Uses dynamic import to load the ESM bundle from the Express app.
 * All /api/* routes are handled here.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any = null;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!app) {
    // @ts-expect-error — pre-built ESM bundle has no declaration file
    const mod = await import("../artifacts/api-server/dist/app.mjs");
    app = mod.default;
  }
  return app(req, res);
}
