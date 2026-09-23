/**
 * SUPERSEDED (Database phase): order.service.ts no longer uses this — real PostgreSQL row locks (`SELECT ... FOR UPDATE`, see db/repos/orders.repo.ts) now provide inventory concurrency protection, correctly, across multiple instances (this in-memory mutex only ever worked within one process). Left in place as a documented pattern for any FUTURE purely in-process, non-DB critical section, not currently used anywhere.
 */
/**
 * Per-key async mutex.
 *
 * PURPOSE: protects inventory decrements (and any other read-check-write
 * sequence) against races WITHIN a single Node.js process/instance.
 *
 * IMPORTANT LIMITATION (documented, not hidden): this only serializes
 * access within one process. It does NOT protect against races across
 * multiple horizontally-scaled instances. Once the database phase begins,
 * this must be replaced by (or layered under) a real transactional
 * mechanism: e.g. a Postgres `SELECT ... FOR UPDATE` row lock, or an atomic
 * `UPDATE inventory SET stock = stock - :qty WHERE stock >= :qty` combined
 * with checking the affected row count, inside a DB transaction. See
 * docs/ARCHITECTURE.md "Inventory concurrency" for the migration plan.
 */

const locks = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => (release = resolve));
  locks.set(
    key,
    previous.then(() => current)
  );

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}
