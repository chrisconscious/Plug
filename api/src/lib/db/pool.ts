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

// Graceful shutdown: stop accepting new pool checkouts and let in-flight
// queries finish before the process exits (e.g. on a container orchestrator
// SIGTERM during a deploy).
process.on("SIGTERM", () => void shutdownPool());
process.on("SIGINT", () => void shutdownPool());
