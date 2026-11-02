import app from "./app";
import { logger } from "./lib/logger";
import { getAdminSupabase } from "./lib/supabase";
import { assertSessionSecret } from "./lib/session-secret";

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

// SEC-010: eager session secret probe. assertSessionSecret() throws when
// SESSION_SECRET is unset or shorter than 32 characters, so the process refuses
// to start rather than booting with a missing or weak session secret.
try {
  assertSessionSecret();
} catch (err) {
  logger.error(
    { err },
    "SESSION_SECRET is required and must be at least 32 characters; aborting startup before listen()",
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
