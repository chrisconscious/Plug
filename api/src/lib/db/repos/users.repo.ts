import { query, queryOne, isPgErrorCode, PG_ERROR_CODES } from "../client";
import { ConflictError } from "../../errors";
import type { User } from "../types";

type UserRow = {
  id: string;
  email: string | null;
  phone_number: string | null;
  full_name: string | null;
  password_hash: string;
  role: User["role"];
  disabled: boolean;
  email_verified: boolean;
  totp_secret: string | null;
  mfa_enabled: boolean;
  created_at: string;
};

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    phoneNumber: row.phone_number,
    fullName: row.full_name,
    passwordHash: row.password_hash,
    role: row.role,
    disabled: row.disabled,
    emailVerified: row.email_verified,
    totpSecret: row.totp_secret,
    mfaEnabled: row.mfa_enabled,
    createdAt: row.created_at,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const row = await queryOne<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
  return row ? toUser(row) : null;
}

/** Primary lookup for the new phone-based login (migration 0037). */
export async function findUserByPhone(phoneNumber: string): Promise<User | null> {
  const row = await queryOne<UserRow>("SELECT * FROM users WHERE phone_number = $1", [phoneNumber]);
  return row ? toUser(row) : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const row = await queryOne<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return row ? toUser(row) : null;
}

/**
 * Inserts a new user, relying on the database's UNIQUE index on email
 * (see migration 0002) as the authoritative uniqueness check — no
 * check-then-insert race window, unlike a "does this email exist?" SELECT
 * followed by a separate INSERT.
 */
export async function insertUser(input: {
  email?: string | null;
  phoneNumber?: string | null;
  fullName?: string | null;
  passwordHash: string;
  role: User["role"];
}): Promise<User> {
  try {
    const row = await queryOne<UserRow>(
      `INSERT INTO users (email, phone_number, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.email ?? null, input.phoneNumber ?? null, input.fullName ?? null, input.passwordHash, input.role]
    );
    return toUser(row!);
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      // Generic message — does not confirm which email/phone is/isn't
      // registered (see docs/SECURITY.md "account enumeration").
      throw new ConflictError("We couldn't complete registration with the details provided.");
    }
    throw err;
  }
}

export async function listAdminUsers(): Promise<User[]> {
  const rows = await query<UserRow>(
    "SELECT * FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') ORDER BY created_at DESC"
  );
  return rows.map(toUser);
}

export type UserWithOrderCount = User & { orderCount: number; totalSpentCents: number };

/** All users with their order counts and lifetime spend (for admin/super-admin lists). */
export async function listAllUsersWithStats(opts: { page?: number; pageSize?: number } = {}): Promise<{ users: UserWithOrderCount[]; total: number }> {
  // `u.*` returns raw snake_case columns — pg does no camelCase conversion,
  // so this must go through toUser() like every other read, rather than
  // being cast directly to a camelCase type. (Confirmed while adding
  // full_name: this function had been silently returning createdAt as
  // undefined for every user — snake_case "created_at" doesn't match a
  // camelCase "createdAt" property access. "id"/"email"/"role"/"disabled"
  // happened to survive only because those specific names contain no
  // underscore, so snake_case and camelCase are identical for them.)
  //
  // Paginated (found unpaginated in a performance audit — this previously
  // fetched every user in the database unconditionally on every admin
  // panel load, an unbounded and ever-growing payload/query cost as the
  // user base grows). `COUNT(*) OVER()` gets the total row count in the
  // SAME query as the page of results, avoiding a second round-trip.
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  type RowWithStats = UserRow & { orderCount: number; totalSpentCents: number; totalCount: number };
  const rows = await query<RowWithStats>(
    `SELECT u.*,
            COUNT(o.id)::int        AS "orderCount",
            COALESCE(SUM(o.total_cents), 0)::int AS "totalSpentCents",
            COUNT(*) OVER()::int AS "totalCount"
     FROM users u
     LEFT JOIN orders o ON o.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );
  return {
    users: rows.map((r) => ({ ...toUser(r), orderCount: r.orderCount, totalSpentCents: r.totalSpentCents })),
    total: rows[0]?.totalCount ?? 0,
  };
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<User | null> {
  const row = await queryOne<UserRow>(
    "UPDATE users SET disabled = $2 WHERE id = $1 RETURNING *",
    [id, disabled]
  );
  return row ? toUser(row) : null;
}

export async function setUserRole(id: string, role: "ADMIN" | "SUPER_ADMIN"): Promise<User | null> {
  const row = await queryOne<UserRow>(
    "UPDATE users SET role = $2 WHERE id = $1 RETURNING *",
    [id, role]
  );
  return row ? toUser(row) : null;
}

export async function markEmailVerified(id: string): Promise<User | null> {
  const row = await queryOne<UserRow>(
    "UPDATE users SET email_verified = true WHERE id = $1 RETURNING *",
    [id]
  );
  return row ? toUser(row) : null;
}

export async function updatePasswordHash(id: string, passwordHash: string): Promise<User | null> {
  const row = await queryOne<UserRow>(
    "UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING *",
    [id, passwordHash]
  );
  return row ? toUser(row) : null;
}

/** Full name and/or phone number — email is deliberately NOT editable here (see addresses.service.ts's sibling profile.service.ts for why: changing a verified email needs its own re-verification flow, which doesn't exist yet, so it's out of scope for this account-page update rather than silently allowing an unverified email swap). */
export async function updateProfile(id: string, patch: { fullName?: string | null; phoneNumber?: string | null }): Promise<User | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.fullName !== undefined) { params.push(patch.fullName); sets.push(`full_name = $${params.length}`); }
  if (patch.phoneNumber !== undefined) { params.push(patch.phoneNumber); sets.push(`phone_number = $${params.length}`); }
  if (sets.length === 0) return findUserById(id);
  params.push(id);
  const row = await queryOne<UserRow>(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return row ? toUser(row) : null;
}

/** Stores a pending TOTP secret. mfa_enabled stays false until enableMfa() confirms a valid code — see auth.service.ts. */
export async function setPendingTotpSecret(id: string, secret: string): Promise<void> {
  await query("UPDATE users SET totp_secret = $2 WHERE id = $1", [id, secret]);
}

export async function setMfaEnabled(id: string, enabled: boolean): Promise<void> {
  await query("UPDATE users SET mfa_enabled = $2 WHERE id = $1", [id, enabled]);
}

/** Full MFA teardown — clears the secret too, not just the flag, so a disabled-then-re-enabled account always starts from a fresh secret. */
export async function clearMfa(id: string): Promise<void> {
  await query("UPDATE users SET mfa_enabled = false, totp_secret = NULL WHERE id = $1", [id]);
}

/** Stamps a successful sign-in (migration 0054) — same user row every time, never a new record. */
export async function touchLastLogin(id: string): Promise<void> {
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [id]);
}
