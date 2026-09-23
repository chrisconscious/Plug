-- ============================================================================
-- Migration 0008: Brand logos and active status
-- ============================================================================
-- Idempotent-safe. Adds:
--   - `brands.active`            : enable/disable a brand (storefront visibility)
--   - `brand_logos`              : per-brand logo metadata (1:1 with brands).
--
-- Storage policy (see docs/DATABASE.md / SECURITY.md): the actual image bytes
-- are stored OUTSIDE PostgreSQL (local disk today, S3-compatible object
-- storage later); this table stores only the safe public URL + storage key +
-- metadata. Created as a separate 1:1 table (rather than 6 extra columns on
-- brands) so "does this brand have a logo" and logo metadata stay together,
-- no duplicate logo rows are possible (UNIQUE brand_id), and removing the
-- logo is a clean DELETE of one row.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS brand_logos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL UNIQUE REFERENCES brands(id) ON DELETE CASCADE,
  storage_key  TEXT NOT NULL,              -- object-storage key (e.g. S3 key); never the client filename
  url          TEXT NOT NULL,              -- public/CDN URL used by the frontend
  content_type TEXT NOT NULL,              -- e.g. image/png, image/jpeg, image/webp
  size_bytes   INTEGER NOT NULL CHECK (size_bytes >= 0),
  width        INTEGER NOT NULL CHECK (width > 0),
  height       INTEGER NOT NULL CHECK (height > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT brand_logos_url_not_blank CHECK (length(btrim(url)) > 0),
  CONSTRAINT brand_logos_key_not_blank CHECK (length(btrim(storage_key)) > 0)
);

CREATE TRIGGER brand_logos_set_updated_at
  BEFORE UPDATE ON brand_logos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions for the new logo table (0007 explicitly does NOT auto-grant for
-- new tables, so we GRANT the same app runtime privileges as product_images).
GRANT SELECT, INSERT, UPDATE, DELETE ON brand_logos TO voguevibe_app_role;

-- ---------------------------------------------------------------------------
-- RBAC reference data: dedicated brand-management permission.
-- Keep in sync with src/lib/rbac.ts (PERMISSIONS + ROLE_PERMISSIONS).
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
  ('brands.manage', 'Create, edit, and manage brand logos & brands.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code)
SELECT r.role, 'brands.manage'
FROM (VALUES ('ADMIN'), ('SUPER_ADMIN')) AS r(role)
ON CONFLICT (role, permission_code) DO NOTHING;
