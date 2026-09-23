-- ============================================================================
-- Migration 0049: In-app notifications
-- ============================================================================
-- A genuinely new feature — no existing notification/event table to extend.
-- One table serves two distinct delivery modes rather than two separate
-- systems:
--   1. USER-SPECIFIC: user_id is set (e.g. "your order shipped") — visible
--      only to that one user.
--   2. ROLE-BROADCAST: user_id is NULL and role_scope is set (e.g. a
--      promotional announcement to all customers, or "low stock" to all
--      admins) — visible to every user currently holding that role.
-- Exactly one of the two must be set (never both, never neither) — a
-- broadcast notification isn't materialized as one row per recipient
-- (which would not scale and would need per-user cleanup); instead
-- read-state for broadcasts is tracked in a separate small table
-- (notification_reads) keyed by (notification_id, user_id), since a
-- broadcast is read/unread independently per recipient.

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  role_scope    TEXT CHECK (role_scope IN ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN')),
  category      TEXT NOT NULL CHECK (category IN
                  ('ORDER', 'PAYMENT', 'PRODUCT', 'PROMOTION', 'WISHLIST', 'INVENTORY', 'CUSTOMER', 'SYSTEM', 'ADMIN', 'SECURITY')),
  title         TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  message       TEXT NOT NULL CHECK (length(btrim(message)) > 0),
  image_url     TEXT,
  entity_type   TEXT,
  entity_id     UUID,
  action_url    TEXT,
  -- Only for USER-SPECIFIC notifications — broadcasts use notification_reads instead.
  is_read       BOOLEAN NOT NULL DEFAULT false,
  read_at       TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT true,
  metadata      JSONB,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_exactly_one_target CHECK (
    (user_id IS NOT NULL AND role_scope IS NULL) OR
    (user_id IS NULL AND role_scope IS NOT NULL)
  ),
  -- is_read/read_at are meaningless (and must stay at their defaults) for
  -- a broadcast row, since "read" there is per-recipient, tracked in
  -- notification_reads — this keeps the single-row broadcast model from
  -- silently drifting into "everyone shares one read state."
  CONSTRAINT notifications_broadcast_not_individually_read CHECK (
    user_id IS NOT NULL OR (is_read = false AND read_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id, is_read, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_role_scope_idx ON notifications (role_scope, active, created_at DESC) WHERE role_scope IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at);

-- Per-recipient read state for BROADCAST notifications only. A row here
-- means "this user has read this broadcast." Absence means unread —
-- no need to pre-create a row per recipient per broadcast (which would
-- again be an unbounded fan-out); unread status is simply the default,
-- established-by-absence state.
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS notification_reads_user_idx ON notification_reads (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO plug_app_role;
GRANT SELECT, INSERT, DELETE ON notification_reads TO plug_app_role;

COMMENT ON TABLE notifications IS 'In-app notifications — either user-specific (user_id set) or role-broadcast (role_scope set). Exactly one of the two per row; see notifications_exactly_one_target.';
COMMENT ON TABLE notification_reads IS 'Per-user read-state for BROADCAST notifications only (role_scope-targeted rows in notifications). User-specific notifications track read state directly on their own row via notifications.is_read.';
COMMENT ON COLUMN notifications.entity_type IS 'What action_url points to, e.g. "order", "product", "brand" — lets the frontend render an appropriate icon/fallback without parsing the URL.';
COMMENT ON COLUMN notifications.active IS 'Lets an admin deactivate a promotional broadcast without deleting it (preserving any read-state history in notification_reads) — the same "deactivate, do not delete" pattern already used for announcements/hero slides elsewhere in this project.';
