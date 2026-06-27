import app from "./app";
import { logger } from "./lib/logger";
import { getAdminSupabase } from "./lib/supabase";

// SEC-006: eager service-role probe. getAdminSupabase() throws when
// SUPABASE_SERVICE_ROLE_KEY is unset, so the process aborts BEFORE listen()
// rather than booting with a degraded anon "admin" client subject to RLS.
try {
  getAdminSupabase();
} catch (err) {
  logger.error(
    { err },
    "SUPABASE_SERVICE_ROLE_KEY is required; aborting startup before listen()",
  );
  throw err;
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
