import { withRoute, json } from "@/lib/http";
import { pool } from "@/lib/db/pool";
import { logger } from "@/lib/logger";

// Unauthenticated, unthrottled-by-design (load balancers/orchestrators poll
// this frequently). Reveals liveness + DB connectivity only — no other
// internal state.
export const GET = withRoute({ auth: "none" }, async () => {
  let dbOk = false;
  try {
    await pool.query("SELECT 1");
    dbOk = true;
  } catch (err) {
    logger.error("Health check: database ping failed", { message: err instanceof Error ? err.message : String(err) });
  }

  return json(
    { status: dbOk ? "ok" : "degraded", database: dbOk ? "up" : "down", timestamp: new Date().toISOString() },
    { status: dbOk ? 200 : 503 }
  );
});
