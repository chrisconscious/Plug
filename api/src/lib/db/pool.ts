/**
 * Shared PostgreSQL connection pool.
 *
 * ONE pool per running process (module-level singleton) — never create a
 * new Pool per request. See docs/DATABASE.md "Connection management" for
 * how pool size must be reasoned about across multiple horizontally-scaled
 * instances.
 */
import { Pool } from "pg";
import { config } from "../config";
import { logger } from "../logger";

export const pool = new Pool({
  connectionString: config.database.connectionString,
  max: config.database.poolMax,
  min: config.database.poolMin,
  idleTimeoutMillis: config.database.idleTimeoutMillis,
  connectionTimeoutMillis: config.database.connectionTimeoutMillis,
  ssl: config.database.ssl ? { rejectUnauthorized: true } : undefined,
});

// Every connection gets a server-side statement timeout as a safety net —
// a runaway or accidentally-unindexed query is killed rather than allowed
// to hold a connection (and any locks it took) indefinitely.
pool.on("connect", (client) => {
  client.query(`SET statement_timeout = ${config.database.statementTimeoutMillis}`).catch((err) => {
    logger.error("Failed to set statement_timeout on new connection", { message: err?.message });
  });
});

pool.on("error", (err) => {
  // Fires for errors on IDLE clients (e.g. the network connection to
  // Postgres dropped) — must be handled or it crashes the process.
  logger.error("Unexpected idle Postgres client error", { message: err.message });
});

let shuttingDown = false;
export async function shutdownPool(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Closing PostgreSQL pool...");
  await pool.end();
}

// No SIGTERM/SIGINT handler here on purpose. On those signals `next start`
// already shuts down gracefully: it stops accepting connections, finishes the
// requests in flight, then exits — and the pool's sockets close with the
// process. Ending the pool as soon as the signal arrived (as this file used to)
// broke exactly those in-flight requests: during a `pm2 restart` under load
// they failed with "Cannot use a pool after calling end on the pool" (500s),
// and the slow exit that followed got the process force-killed, dropping open
// connections (the browser's ERR_CONNECTION_CLOSED). shutdownPool() remains
// for scripts and tests that own their own lifecycle.
