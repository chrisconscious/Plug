import { query, queryOne } from "../client";
import type { Role } from "../rbac";

export type NotificationCategory =
  | "ORDER" | "PAYMENT" | "PRODUCT" | "PROMOTION" | "WISHLIST"
  | "INVENTORY" | "CUSTOMER" | "SYSTEM" | "ADMIN" | "SECURITY";

export type Notification = {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  imageUrl: string | null;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  image_url: string | null;
  entity_type: string | null;
  entity_id: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
};

const toNotification = (r: NotificationRow): Notification => ({
  id: r.id,
  category: r.category,
  title: r.title,
  message: r.message,
  imageUrl: r.image_url,
  entityType: r.entity_type,
  entityId: r.entity_id,
  actionUrl: r.action_url,
  isRead: r.is_read,
  createdAt: r.created_at,
});

// Shared UNION: a user's own notifications (real is_read column) combined
// with active broadcasts for their role (is_read computed via NOT EXISTS
// against notification_reads, since a broadcast has no per-row read flag
// of its own — see migration 0049's header for why).
const UNION_SQL = `
  SELECT n.id, n.category, n.title, n.message, n.image_url, n.entity_type, n.entity_id, n.action_url,
         n.is_read, n.created_at
    FROM notifications n
   WHERE n.user_id = $1
  UNION ALL
  SELECT n.id, n.category, n.title, n.message, n.image_url, n.entity_type, n.entity_id, n.action_url,
         (nr.user_id IS NOT NULL) AS is_read, n.created_at
    FROM notifications n
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
   WHERE n.role_scope = $2 AND n.active = true
`;

export async function listNotificationsForUser(
  userId: string,
  role: Role,
  opts: { page?: number; pageSize?: number } = {}
): Promise<{ items: Notification[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const [rows, countRow] = await Promise.all([
    query<NotificationRow>(
      `SELECT * FROM (${UNION_SQL}) combined ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [userId, role, pageSize, offset]
    ),
    queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM (${UNION_SQL}) combined`, [userId, role]),
  ]);
  return { items: rows.map(toNotification), total: Number(countRow?.n ?? 0) };
}

/**
 * Lightweight by design — two small COUNT queries (each using the
 * existing partial indexes from migration 0049), never fetches full
 * notification rows just to count them. This is what the header bell's
 * badge polls, so it needs to stay cheap even at high polling frequency.
 */
export async function getUnreadCountForUser(userId: string, role: Role): Promise<number> {
  const [ownUnread, broadcastUnread] = await Promise.all([
    queryOne<{ n: string }>(
      "SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND is_read = false",
      [userId]
    ),
    queryOne<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM notifications n
        WHERE n.role_scope = $2 AND n.active = true
          AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = $1)`,
      [userId, role]
    ),
  ]);
  return Number(ownUnread?.n ?? 0) + Number(broadcastUnread?.n ?? 0);
}

/** Marks one notification read for this user — works for both a user-specific row (UPDATE, ownership-scoped) and a broadcast row (INSERT into notification_reads, idempotent). Returns false if the notification doesn't exist or isn't visible to this user/role at all. */
export async function markNotificationRead(userId: string, role: Role, notificationId: string): Promise<boolean> {
  const own = await query<{ id: string }>(
    "UPDATE notifications SET is_read = true, read_at = now() WHERE id = $1 AND user_id = $2 RETURNING id",
    [notificationId, userId]
  );
  if (own.length > 0) return true;

  // Not a user-specific row of theirs — check it's a broadcast actually
  // visible to their role before recording a read (never trust the id
  // alone: a customer must not be able to mark an admin-only broadcast
  // as read, which would otherwise leak its existence).
  const broadcast = await queryOne<{ id: string }>(
    "SELECT id FROM notifications WHERE id = $1 AND role_scope = $2 AND active = true",
    [notificationId, role]
  );
  if (!broadcast) return false;
  await query(
    "INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [notificationId, userId]
  );
  return true;
}

export async function markAllReadForUser(userId: string, role: Role): Promise<void> {
  await query("UPDATE notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND is_read = false", [userId]);
  await query(
    `INSERT INTO notification_reads (notification_id, user_id)
     SELECT n.id, $1 FROM notifications n
      WHERE n.role_scope = $2 AND n.active = true
        AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = $1)
     ON CONFLICT DO NOTHING`,
    [userId, role]
  );
}

export type CreateNotificationInput = {
  userId?: string;
  roleScope?: Role;
  category: NotificationCategory;
  title: string;
  message: string;
  imageUrl?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
};

export async function createNotification(input: CreateNotificationInput): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO notifications (user_id, role_scope, category, title, message, image_url, entity_type, entity_id, action_url, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
     RETURNING id`,
    [
      input.userId ?? null,
      input.roleScope ?? null,
      input.category,
      input.title,
      input.message,
      input.imageUrl ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.actionUrl ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdBy ?? null,
    ]
  );
  return row!.id;
}

/** Admin view of broadcast notifications the admin/superadmin panel manages (promotional announcements + role-targeted operational broadcasts) — not user-specific ones, which have no independent admin-management use case. */
export async function listBroadcastNotifications(): Promise<(Notification & { roleScope: Role; active: boolean })[]> {
  const rows = await query<NotificationRow & { role_scope: Role; active: boolean }>(
    `SELECT id, category, title, message, image_url, entity_type, entity_id, action_url, is_read, created_at, role_scope, active
       FROM notifications WHERE role_scope IS NOT NULL ORDER BY created_at DESC LIMIT 200`
  );
  return rows.map((r) => ({ ...toNotification(r), roleScope: r.role_scope, active: r.active }));
}

export async function setBroadcastActive(id: string, active: boolean): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "UPDATE notifications SET active = $2 WHERE id = $1 AND role_scope IS NOT NULL RETURNING id",
    [id, active]
  );
  return rows.length > 0;
}
