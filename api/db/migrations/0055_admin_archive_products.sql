-- ============================================================================
-- Migration 0055: Admins may archive/restore products
-- ============================================================================
--
-- Owner decision: regular ADMINs (not only SUPER_ADMIN) can archive
-- ("delete") and restore products. Archiving is a soft state change
-- (products.archived_at, migration 0053) — nothing is hard-deleted and order
-- history is untouched. src/lib/rbac.ts is the enforced source of truth; this
-- keeps the auditable reference copy (permissions / role_permissions, see
-- 0002 and 0043) in sync with it.

UPDATE permissions SET description = 'Archive and restore products' WHERE code = 'products.delete';

INSERT INTO role_permissions (role, permission_code) VALUES
  ('ADMIN', 'products.delete')
ON CONFLICT DO NOTHING;
