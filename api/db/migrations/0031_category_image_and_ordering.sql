-- ============================================================================
-- Migration 0031: Category image, active flag, and display order
-- ============================================================================
-- Adds what's needed for a genuinely dynamic, admin-managed "Shop by
-- Category" storefront carousel: an uploadable image per category, an
-- active/inactive toggle, and an explicit display order — mirroring the
-- pattern already established for lifestyles (migration 0019), but
-- deliberately NOT copying two of that migration's specifics, because
-- categories are not in the same starting position lifestyles were:
--
--   1. `active` defaults to TRUE here, not FALSE. Lifestyles were a brand
--      new taxonomy with zero existing rows when introduced, so
--      defaulting inactive-until-configured was safe. Categories already
--      have live rows powering real navigation and real products RIGHT
--      NOW — defaulting them to inactive would instantly hide every
--      existing category from the storefront the moment this migration
--      runs. That would be a severe, self-inflicted regression, not a
--      neutral schema change.
--   2. There is no "active requires image" CHECK constraint here, unlike
--      lifestyles. Every existing category has `image_url IS NULL` today
--      and must remain usable — this app already has a real icon-based
--      fallback for categories (migration 0012's `icon` column) that
--      lifestyles never had. Requiring an image before a category can be
--      active would both break existing data on migration and remove a
--      legitimate, already-working display mode.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_image_url_not_blank;
ALTER TABLE categories
  ADD CONSTRAINT categories_image_url_not_blank
    CHECK (image_url IS NULL OR length(btrim(image_url)) > 0);

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_display_order_non_negative;
ALTER TABLE categories
  ADD CONSTRAINT categories_display_order_non_negative
    CHECK (display_order >= 0);

CREATE INDEX IF NOT EXISTS categories_active_order_idx ON categories (active, display_order);

COMMENT ON COLUMN categories.image_url IS 'Public URL for the category''s storefront card image (uploaded through the validated image pipeline). Nullable — a category without one falls back to its icon (see migration 0012), unlike lifestyles which require a photo.';
COMMENT ON COLUMN categories.image_storage_key IS 'Storage-provider key for the uploaded image, needed to delete the underlying file on replace/removal — see storage/provider.ts. NULL whenever image_url is NULL.';
COMMENT ON COLUMN categories.active IS 'Whether the category is discoverable on the storefront (Shop by Category carousel, navigation). Defaults TRUE so existing categories are unaffected by this migration — see this file''s header comment.';
COMMENT ON COLUMN categories.display_order IS 'Sort order for the Shop by Category storefront carousel (ascending). All existing rows default to 0 (equal ordering, ties broken by name/created_at at query time) until an admin sets an explicit order.';

-- Table-level grants from the 0007 baseline (renamed to plug_app_role in
-- migration 0030) already cover new columns on an existing table — no
-- additional GRANT is needed here.
