import { query, queryOne } from "../client";
import { generateBearerToken, hashToken } from "../../security/tokenHash";

export type PasswordResetToken = {
  id: string;
  userId: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  user_id: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

function toToken(row: Row): PasswordResetToken {
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

/**
 * Generates a real random token, stores only its hash, and returns the
 * PLAINTEXT token separately for the caller to put in the email link —
 * never persisted anywhere (see migration 0028 and security/tokenHash.ts).
 */
export async function insertToken(input: { userId: string; expiresAt: Date }): Promise<{ token: PasswordResetToken; plaintextToken: string }> {
  const plaintextToken = generateBearerToken();
  const row = await queryOne<Row>(
    `INSERT INTO password_reset_tokens (user_id, expires_at, token_hash) VALUES ($1, $2, $3) RETURNING *`,
    [input.userId, input.expiresAt.toISOString(), hashToken(plaintextToken)]
  );
  return { token: toToken(row!), plaintextToken };
}

/** Looks up a token by its PLAINTEXT value (as received from the email link) — hashes it first, never queries by the plaintext itself. */
export async function findByPlaintextToken(plaintextToken: string): Promise<PasswordResetToken | null> {
  const row = await queryOne<Row>("SELECT * FROM password_reset_tokens WHERE token_hash = $1", [hashToken(plaintextToken)]);
  return row ? toToken(row) : null;
}

/** Marks a token used. Called only after confirming it's unexpired and unconsumed — see auth.service.ts resetPassword(). */
export async function consumeToken(id: string): Promise<void> {
  await query("UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1", [id]);
}

/** Invalidates every outstanding reset token for a user — called when a new one is requested (only the newest link should work) and after a successful password change. */
export async function invalidateAllForUser(userId: string): Promise<void> {
  await query("UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL", [userId]);
}

/** Periodic cleanup job (not called from request paths) — same pattern as sessions.repo.ts / email-verification.repo.ts. */
export async function deleteExpiredTokens(olderThan: Date): Promise<number> {
  const rows = await query("DELETE FROM password_reset_tokens WHERE expires_at < $1 RETURNING id", [olderThan.toISOString()]);
  return rows.length;
}
