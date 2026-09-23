import { query, queryOne } from "../client";
import type { Session } from "../types";

type SessionRow = {
  id: string;
  user_id: string;
  revoked: boolean;
  created_at: string;
  expires_at: string;
};

function toSession(row: SessionRow): Session {
  return { id: row.id, userId: row.user_id, revoked: row.revoked, createdAt: row.created_at, expiresAt: row.expires_at };
}

export async function insertSession(input: { id: string; userId: string; expiresAt: Date }): Promise<Session> {
  const row = await queryOne<SessionRow>(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3) RETURNING *`,
    [input.id, input.userId, input.expiresAt.toISOString()]
  );
  return toSession(row!);
}

export async function findSessionById(id: string): Promise<Session | null> {
  const row = await queryOne<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
  return row ? toSession(row) : null;
}

export async function revokeSessionById(id: string): Promise<void> {
  await query("UPDATE sessions SET revoked = true WHERE id = $1", [id]);
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await query("UPDATE sessions SET revoked = true WHERE user_id = $1 AND revoked = false", [userId]);
}

/** Periodic cleanup job (not called from request paths) — see docs/DATABASE.md "Data lifecycle". */
export async function deleteExpiredSessions(olderThan: Date): Promise<number> {
  const rows = await query("DELETE FROM sessions WHERE expires_at < $1 RETURNING id", [olderThan.toISOString()]);
  return rows.length;
}
