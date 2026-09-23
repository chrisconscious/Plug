-- Migration 0044: per-admin permission grants
--
-- The role matrix in src/lib/rbac.ts is a hard-coded allow-list per role
-- (CUSTOMER / ADMIN / SUPER_ADMIN). This migration adds the ability for a
-- Super Admin to grant *individual* extra permissions to an Admin account
-- beyond what the role provides — e.g. granting `content.manage` to a
-- specific Admin without promoting them to Super Admin.
--
-- Enforcement: withRoute() in http.ts now calls hasPermissionForUser()
-- (rbac.ts) which checks role-based permissions first (zero-latency, no
-- DB) and only queries admin_permissions when the role check fails. A
-- 60-second TTL cache per user avoids hammering the DB.
--
-- The table is intentionally NOT a replacement for ROLE_PERMISSIONS — it
-- is a pure overlay. Deleting a row only removes the *extra* grant; the
-- role-based permission still applies if the role includes it.

CREATE TABLE IF NOT EXISTS admin_permissions (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by      UUID REFERENCES users(id),
  PRIMARY KEY (user_id, permission_code)
);

COMMENT ON TABLE admin_permissions IS 'Per-admin extra permission grants, overlaying the hard-coded role matrix in src/lib/rbac.ts. A Super Admin grants/revokes individual permissions for Admin accounts; enforcement is in http.ts via hasPermissionForUser().';

GRANT SELECT, INSERT, DELETE ON admin_permissions TO plug_app_role;