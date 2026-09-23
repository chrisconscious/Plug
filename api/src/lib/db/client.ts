/**
 * Query and transaction helpers used by every repository in db/repos/.
 *
 * No repository file should import `pool` directly and call `.query()` on
 * it for anything transactional — always go through `withTransaction` when
 * more than one statement must succeed or fail together (see
 * docs/DATABASE.md "Transactions" for which operations require this).
 */
import type { QueryResultRow } from "pg";
import { pool } from "./pool";
import type { PoolClient } from "pg";

/** Postgres error shape we care about (unique_violation, etc.) — `pg` doesn't export a typed Error class. */
export type PgError = Error & { code?: string; constraint?: string; detail?: string };

export const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  NOT_NULL_VIOLATION: "23502",
} as const;

export function isPgErrorCode(err: unknown, code: string): err is PgError {
  return typeof err === "object" && err !== null && (err as PgError).code === code;
}

/** Single, non-transactional statement — the common case for reads and simple single-row writes. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Runs `fn` inside a BEGIN/COMMIT transaction on a single checked-out
 * connection, rolling back on any thrown error. This is where row-level
 * locking (`SELECT ... FOR UPDATE`) for inventory concurrency, and
 * multi-table writes like order creation, happen — see
 * db/repos/orders.repo.ts.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // Rollback itself failing (e.g. connection already dead) is logged
      // but must not mask the original error.
    });
    throw err;
  } finally {
    client.release();
  }
}
