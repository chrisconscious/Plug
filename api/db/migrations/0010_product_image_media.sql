-- ============================================================================
-- Migration 0010: Product image media metadata
-- ============================================================================
-- Extends `product_images` (created in 0003) with the object-storage metadata
-- needed to support real admin image upload/replace/delete. The policy is the
-- same as brand_logos (see 0008 / docs/DATABASE.md / SECURITY.md): the image
-- BYTES live outside PostgreSQL (local disk today under public/uploads/products,
-- S3-compatible object storage later); this table stores only the safe public
-- URL + storage key + metadata.
--
-- Backward compatibility: seed rows (and any rows inserted by the legacy seed
-- script) carry an absolute HTTPS URL and NO storage metadata. The new columns
-- are therefore all NULLABLE. Admin-uploaded images populate them; seed/URL
-- images simply have NULL storage metadata. `listImagesForProducts` serves
-- images by `url` regardless of origin, per the ordering in `position`.
--
-- ORIGINAL 0003 columns (kept as-is): id, product_id, url, position, alt_text,
-- created_at. This migration only ADDS metadata columns.
-- ============================================================================

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS storage_key   TEXT,
  ADD COLUMN IF NOT EXISTS content_type  TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes    INTEGER,
  ADD COLUMN IF NOT EXISTS width         INTEGER,
  ADD COLUMN IF NOT EXISTS height        INTEGER;

-- Same advisory CHECKs as brand_logos so bad values fail fast at the DB.
ALTER TABLE product_images
  DROP CONSTRAINT IF EXISTS product_images_key_not_blank;
ALTER TABLE product_images
  ADD CONSTRAINT product_images_key_not_blank
    CHECK (storage_key IS NULL OR length(btrim(storage_key)) > 0);
ALTER TABLE product_images
  DROP CONSTRAINT IF EXISTS product_images_size_check;
ALTER TABLE product_images
  ADD CONSTRAINT product_images_size_check
    CHECK (size_bytes IS NULL OR size_bytes >= 0);
ALTER TABLE product_images
  DROP CONSTRAINT IF EXISTS product_images_width_check;
ALTER TABLE product_images
  ADD CONSTRAINT product_images_width_check
    CHECK (width IS NULL OR width > 0);
ALTER TABLE product_images
  DROP CONSTRAINT IF EXISTS product_images_height_check;
ALTER TABLE product_images
  ADD CONSTRAINT product_images_height_check
    CHECK (height IS NULL OR height > 0);

-- The existing (product_id, position) composite index (0003) already backs the
-- "this product's images, in order" fetch that detail pages use. An explicit
-- index on the storage key supports lookup/cleanup of orphaned objects.
CREATE INDEX IF NOT EXISTS product_images_storage_key_idx
  ON product_images (storage_key);

-- Product images are replaced by delete+insert, so no updated_at trigger is
-- added (consistent with the 0003 design note).

COMMENT ON COLUMN product_images.storage_key  IS 'Object-storage key for admin-uploaded images (never the client filename). NULL for legacy/seed URL-only rows.';
COMMENT ON COLUMN product_images.content_type IS 'image/png | image/jpeg | image/webp — validated server-side from bytes. NULL for legacy rows.';
COMMENT ON COLUMN product_images.size_bytes  IS 'File size in bytes (admin-uploaded images only). NULL for legacy rows.';
COMMENT ON COLUMN product_images.width       IS 'Pixel width (admin-uploaded images only). NULL for legacy rows.';
COMMENT ON COLUMN product_images.height      IS 'Pixel height (admin-uploaded images only). NULL for legacy rows.';
