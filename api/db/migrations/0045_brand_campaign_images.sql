-- ============================================================================
-- Migration 0045: Brand campaign images
-- ============================================================================
-- Adds a large lifestyle/campaign photo per brand for the "Shop by Brand"
-- storefront redesign (large vertical image cards with the brand name
-- overlaid, one row, swipeable) — distinct from brand_logos (migration
-- 0008), which is a small logo mark used elsewhere (the brand-name strip,
-- brand detail page header). A brand may have a logo, a campaign image,
-- both, or neither; this is deliberately a SEPARATE 1:1 table rather than
-- extra columns on brand_logos or brands, mirroring the exact reasoning
-- migration 0008 already used: "does this brand have a campaign image"
-- and its metadata stay together, no duplicate rows are possible, and
-- removing it is a clean DELETE of one row.

CREATE TABLE IF NOT EXISTS brand_campaign_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL UNIQUE REFERENCES brands(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  url           TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes >= 0),
  width         INTEGER NOT NULL CHECK (width > 0),
  height        INTEGER NOT NULL CHECK (height > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT brand_campaign_images_url_not_blank CHECK (length(btrim(url)) > 0)
);

CREATE TRIGGER brand_campaign_images_set_updated_at
  BEFORE UPDATE ON brand_campaign_images
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Admin-controlled display order for the storefront row (which brand shows
-- first, per the earlier Shop by Brand redesign's own explicit
-- requirement) — added on brands directly, not the image table, since
-- ordering is a property of the BRAND's storefront placement, independent
-- of whether it currently has a campaign image at all.
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0
    CHECK (display_order >= 0);

CREATE INDEX IF NOT EXISTS brands_active_order_idx ON brands (active, display_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON brand_campaign_images TO plug_app_role;

COMMENT ON TABLE brand_campaign_images IS 'Large lifestyle/campaign photo per brand for the storefront Shop by Brand cards. Distinct from brand_logos (a small logo mark) — see this migration''s header for why they are separate tables.';
COMMENT ON COLUMN brands.display_order IS 'Admin-controlled position in the storefront Shop by Brand row (ascending). All existing rows default to 0 (equal ordering, tie-broken by name at query time) until an admin sets an explicit order.';
