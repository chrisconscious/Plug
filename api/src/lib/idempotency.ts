/**
 * SUPERSEDED (Database phase): order.service.ts no longer uses this — the `idempotency_keys` table's composite PRIMARY KEY (migration 0005) plus a transactional INSERT (see db/repos/orders.repo.ts) now provides idempotency correctly across multiple instances, which this in-memory Map never could. Left in place as a documented pattern for any FUTURE non-persisted idempotency need, not currently used anywhere.
 */
/**
 * Idempotency-key handling for unsafe, side-effecting requests (order
 * creation, in the current scope). The client sends an `Idempotency-Key`
 * header (a UUID it generates once per logical attempt); if the same key is
 * replayed — e.g. because "Place Order" was double-clicked, or a network
 * timeout caused a client-side retry — we return the ORIGINAL result
 * instead of creating a second order.
 *
 * CURRENT IMPLEMENTATION: in-memory Map, TTL-based cleanup, single process
 * only. In the database phase this must move to a persistent table
 * (idempotency_keys: key, user_id, endpoint, response_body, status,
 * created_at) with a unique constraint on (user_id, endpoint, key), written
 * inside the same transaction as the side effect it protects.
 */
import { ConflictError } from "./errors";

type IdempotencyRecord = {
  status: "in_progress" | "completed";
  result?: unknown;
  createdAt: number;
};

const store = new Map<string, IdempotencyRecord>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function sweep() {
  const now = Date.now();
  for (const [key, record] of store) {
    if (now - record.createdAt > TTL_MS) store.delete(key);
  }
}

/**
 * Runs `fn` exactly once per (userId, scope, idempotencyKey). Concurrent or
 * repeated calls with the same key return the first call's result. A
 * request reusing the key while the first attempt is still in-flight is
 * rejected with 409 rather than silently double-processed.
 */
export async function withIdempotency<T>(
  scope: string,
  userId: string,
  idempotencyKey: string | null,
  fn: () => Promise<T>
): Promise<T> {
  sweep();
  if (!idempotencyKey) {
    // Idempotency is opt-in via header for now; callers that require it
    // strictly (order creation) should validate the header is present
    // before calling this, which order.service.ts does.
    return fn();
  }

  const compoundKey = `${scope}:${userId}:${idempotencyKey}`;
  const existing = store.get(compoundKey);
  if (existing) {
    if (existing.status === "in_progress") {
      throw new ConflictError("This request is already being processed.");
    }
    return existing.result as T;
  }

  store.set(compoundKey, { status: "in_progress", createdAt: Date.now() });
  try {
    const result = await fn();
    store.set(compoundKey, { status: "completed", result, createdAt: Date.now() });
    return result;
  } catch (err) {
    // Allow retry with the same key after a failure.
    store.delete(compoundKey);
    throw err;
  }
}
