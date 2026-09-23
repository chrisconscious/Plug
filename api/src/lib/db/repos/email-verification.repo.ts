import { query, queryOne } from "../client";
import { generateBearerToken, hashToken } from "../../security/tokenHash";

export type EmailVerificationToken = {
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

function toToken(row: Row): EmailVerificationToken {
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
 * this is the only place the plaintext value ever exists; it is never
 * persisted anywhere (see migration 0028 and security/tokenHash.ts).
 */
export async function insertToken(input: { userId: string; expiresAt: Date }): Promise<{ token: EmailVerificationToken; plaintextToken: string }> {
  const plaintextToken = generateBearerToken();
  const row = await queryOne<Row>(
    `INSERT INTO email_verification_tokens (user_id, expires_at, token_hash) VALUES ($1, $2, $3) RETURNING *`,
    [input.userId, input.expiresAt.toISOString(), hashToken(plaintextToken)]
  );
  return { token: toToken(row!), plaintextToken };
}

/** Looks up a token by its PLAINTEXT value (as received from the email link) — hashes it first, never queries by the plaintext itself. */
export async function findByPlaintextToken(plaintextToken: string): Promise<EmailVerificationToken | null> {
  const row = await queryOne<Row>("SELECT * FROM email_verification_tokens WHERE token_hash = $1", [hashToken(plaintextToken)]);
  return row ? toToken(row) : null;
}

/** Marks a token used. Called only after confirming it's unexpired and unconsumed — see auth.service.ts verifyEmail(). */
export async function consumeToken(id: string): Promise<void> {
  await query("UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1", [id]);
}

/** Periodic cleanup job (not called from request paths) — same pattern as sessions.repo.ts deleteExpiredSessions. */
export async function deleteExpiredTokens(olderThan: Date): Promise<number> {
  const rows = await query("DELETE FROM email_verification_tokens WHERE expires_at < $1 RETURNING id", [olderThan.toISOString()]);
  return rows.length;
}
