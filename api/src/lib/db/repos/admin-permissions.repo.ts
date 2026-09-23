/**
 * Per-admin permission grants — overlay on top of the hard-coded role
 * matrix in rbac.ts. Only stores *extra* permissions granted by a Super
 * Admin to an individual Admin account; role-based permissions are always
 * inherited and are NOT mirrored here.
 *
 * A 60-second TTL cache per user avoids a DB round-trip on every single
 * admin request. The cache is invalidated immediately on grant/revoke
 * (via invalidateGrantCache) so the owning Super Admin sees the effect
 * of their own change instantly.
 */

import { query, withTransaction } from "../client";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  permissions: Set<string>;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Returns the set of per-admin grant codes for a user. Uses a 60-second
 * in-memory cache per user to avoid a DB round-trip on every request.
 * Returns an empty set (not null) when no grants exist, so callers can
 * always safely `.has()` on the result.
 */
export async function getGrantedPermissions(userId: string): Promise<Set<string>> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiry > now) return hit.permissions;

  const rows = await query<{ permission_code: string }>(
    "SELECT permission_code FROM admin_permissions WHERE user_id = $1",
    [userId]
  );
  const permissions = new Set(rows.map((r) => r.permission_code));
  cache.set(userId, { permissions, expiry: now + CACHE_TTL_MS });
  return permissions;
}

/** Immediate cache invalidation — call after grant or revoke. */
export function invalidateGrantCache(userId: string): void {
  cache.delete(userId);
}

export async function listGrantedPermissions(userId: string) {
  return query<{ permissionCode: string; grantedAt: string; grantedByEmail: string | null }>(
    `SELECT ap.permission_code AS "permissionCode",
            ap.granted_at      AS "grantedAt",
            u.email             AS "grantedByEmail"
     FROM admin_permissions ap
     LEFT JOIN users u ON u.id = ap.granted_by
     WHERE ap.user_id = $1
     ORDER BY ap.permission_code`,
    [userId]
  );
}

/**
 * Bulk-set an admin's extra permissions (replace strategy).
 * Wrapped in a transaction so partial writes never happen.
 */
export async function setGrantedPermissions(userId: string, permissionCodes: string[], grantedBy: string) {
  const unique = [...new Set(permissionCodes)];
  await withTransaction(async (client) => {
    await client.query("DELETE FROM admin_permissions WHERE user_id = $1", [userId]);
    for (const code of unique) {
      await client.query(
        "INSERT INTO admin_permissions (user_id, permission_code, granted_by) VALUES ($1, $2, $3)",
        [userId, code, grantedBy]
      );
    }
  });
  invalidateGrantCache(userId);
}