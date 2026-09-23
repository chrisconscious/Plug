-- ============================================================================
-- Migration 0013: Hero advertisements (homepage carousel slides)
-- ============================================================================
-- Idempotent-safe. Adds a `hero_advertisements` table driving the storefront
-- homepage carousel, plus the `content.manage` permission gate by which only
-- Super Admins create/edit/reorder slides.
--
-- Storage policy (mirrors 0008/0010): image bytes live OUTSIDE Postgres (local
-- disk today, S3-compatible object storage later) via src/lib/storage. This
-- table stores the safe public `image_url` plus, when the image was uploaded
-- through the validated pipeline, the storage key + true content type/dimensions
-- (magic-byte sniffed — never trusted from the client).

CREATE TABLE IF NOT EXISTS hero_advertisements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_label  TEXT NOT NULL,
  headline        TEXT NOT NULL,
  description     TEXT NOT NULL,
  cta_text        TEXT NOT NULL,
  cta_url         TEXT NOT NULL,
  badge_text      TEXT,
  editorial_text  TEXT,
  hero_type       TEXT NOT NULL DEFAULT 'lifestyle'
                  CONSTRAINT hero_type_allowed CHECK (hero_type IN ('promotional', 'lifestyle', 'editorial')),
  image_url       TEXT NOT NULL DEFAULT '',
  storage_key     TEXT,
  content_type    TEXT,
  size_bytes      INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  width           INTEGER CHECK (width IS NULL OR width > 0),
  height          INTEGER CHECK (height IS NULL OR height > 0),
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  start_date      TIMESTAMPTZ,
  end_date        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hero_campaign_label_not_blank  CHECK (length(btrim(campaign_label)) > 0),
  CONSTRAINT hero_headline_not_blank        CHECK (length(btrim(headline)) > 0),
  CONSTRAINT hero_description_not_blank     CHECK (length(btrim(description)) > 0),
  CONSTRAINT hero_cta_text_not_blank        CHECK (length(btrim(cta_text)) > 0),
  CONSTRAINT hero_cta_url_not_blank         CHECK (length(btrim(cta_url)) > 0),
  CONSTRAINT hero_date_range_valid          CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

CREATE TRIGGER hero_advertisements_set_updated_at
  BEFORE UPDATE ON hero_advertisements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Storage policy footgun: an active (not-yet-expired) slide must carry a
-- displayable image. Enforce at insert/update time so a broken/blank slide can
-- never go live. NOTE: cannot reference now() in a CHECK (must be IMMUTABLE),
-- so this guarantees image_url only when the slide is active — the scheduled /
-- already-expired cases are excluded by the explicit is_active guard the app
-- applies, and the UI prevents publishing without an image.
ALTER TABLE hero_advertisements
  DROP CONSTRAINT IF EXISTS hero_active_requires_image;
ALTER TABLE hero_advertisements
  ADD CONSTRAINT hero_active_requires_image
  CHECK (NOT is_active OR length(btrim(image_url)) > 0);

-- Grant the same app-runtime CRUD as product_images (0007 does not auto-grant
-- for new tables; 0008 documents this convention explicitly).
GRANT SELECT, INSERT, UPDATE, DELETE ON hero_advertisements TO voguevibe_app_role;

-- Partial index: cheap lookups for exactly the query the homepage runs —
-- active slides that are in range, in display order. The date-window filter
-- is applied in the WHERE clause at query time (a predicate using now() in a
-- partial index would be frozen at creation, which is why it is NOT baked in).
CREATE INDEX IF NOT EXISTS hero_advertisements_active_order_idx
  ON hero_advertisements (display_order)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- RBAC reference data: dedicated homepage-content permission (Super Admin).
-- Keep in sync with src/lib/rbac.ts (PERMISSIONS + ROLE_PERMISSIONS).
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
  ('content.manage', 'Create, edit, reorder, and publish homepage hero advertisements.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code)
SELECT r.role, 'content.manage'
FROM (VALUES ('SUPER_ADMIN')) AS r(role)
ON CONFLICT (role, permission_code) DO NOTHING;
