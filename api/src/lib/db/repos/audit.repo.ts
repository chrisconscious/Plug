import type { PoolClient } from "pg";
import { query } from "../client";
import type { AuditEvent } from "../types";

type AuditInput = Omit<AuditEvent, "id" | "createdAt">;

/**
 * Use this variant when the audit event must be atomic with other writes
 * already happening on an open transaction client (e.g. order creation,
 * order status updates — see orders.repo.ts). Using the shared pool here
 * instead would insert the audit row on a DIFFERENT connection, outside
 * the transaction, which could record an audit event for a write that
 * then rolls back.
 */
export async function recordAuditEventOnClient(client: PoolClient, event: AuditInput): Promise<void> {
  await client.query(
    `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [event.actorId, event.actorRole, event.action, event.targetType, event.targetId, JSON.stringify(event.metadata ?? {})]
  );
}

/** Standalone variant for audit events not already inside another transaction (e.g. registration, admin CRUD). */
export async function recordAuditEvent(event: AuditInput): Promise<void> {
  await query(
    `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [event.actorId, event.actorRole, event.action, event.targetType, event.targetId, JSON.stringify(event.metadata ?? {})]
  );
}

type AuditRow = {
  id: string;
  actor_id: string;
  actor_role: AuditEvent["actorRole"];
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function listAuditEvents(limit = 100): Promise<AuditEvent[]> {
  const rows = await query<AuditRow>(
    "SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    metadata: r.metadata ?? undefined,
    createdAt: r.created_at,
  }));
}
