-- Migration 0043: sync RBAC reference tables with src/lib/rbac.ts
--
-- permissions / role_permissions are auditable reference copies of the
-- authorization matrix defined in src/lib/rbac.ts (see docs/DATABASE.md §3).
-- `lifestyles.manage` was added to rbac.ts for the lifestyle collections
-- module but never backfilled here, so the DB copy drifted. Backfill it —
-- also refresh any descriptions that changed since seed — so a future CI
-- diff check (rbac.ts vs role_permissions) passes again.

INSERT INTO permissions (code, description) VALUES
  ('lifestyles.manage', 'Manage lifestyle collections')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('SUPER_ADMIN', 'lifestyles.manage')
ON CONFLICT DO NOTHING;

-- Normalize descriptions to match PERMISSION_LABELS in rbac.ts exactly.
UPDATE permissions p SET description = v.description
FROM (VALUES
  ('brands.manage',          'Create and manage brands and categories'),
  ('content.manage',         'Manage homepage and storefront editorial content'),
  ('payment_methods.manage', 'Manage payment methods')
) AS v(code, description)
WHERE p.code = v.code AND p.description <> v.description;