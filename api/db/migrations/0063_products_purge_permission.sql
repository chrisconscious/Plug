-- ============================================================================
-- Migration 0063: "products.purge" — permanently delete archived products
-- ============================================================================
--
-- Permanent delete (migration 0061) was Super Admin only by role. It is now
-- its own permission so a Super Admin can also grant it to individual Admins
-- in Roles & Permissions. Super Admins have it by default; Admins do not.
-- RBAC reference data only. Keep in sync with src/lib/rbac.ts. Idempotent.

INSERT INTO permissions (code, description) VALUES
  ('products.purge', 'Permanently delete archived products')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES ('SUPER_ADMIN', 'products.purge')
ON CONFLICT (role, permission_code) DO NOTHING;
