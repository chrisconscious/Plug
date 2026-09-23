-- ============================================================================
-- Migration 0011: Gender / Audience many-to-many + category imagery
-- ============================================================================
-- Replaces the (legacy, single-column) `products.gender` model with an
-- authoritative many-to-many audience model:
--
--   gender_audiences                the closed set: women / men / unisex
--   product_gender_audiences        join: a product can belong to ANY number
--                                    of audiences (e.g. a unisex tee is both
--                                    "men" AND "unisex"; a dress is "women"
--                                    only).
--
-- The join table is the AUTHORITATIVE source for gender filtering on the
-- storefront (product-filter.repo.ts now filters through it with ANY-match
-- semantics — a product matches `gender=men` if its audience set contains
-- "men", whether or not it is also unisex). `products.gender` is left in
-- place with its existing data intact (no destructive migration), so nothing
-- that still reads it breaks — but new reads must go through the join.
--
-- Backfill: every existing product that has a `products.gender` value gets a
-- corresponding join row; NULL-gender products get none (they remain
-- unassigned until an admin assigns audiences via the Admin product form).
--
-- Also adds `categories.image_url` (object-storage-style URL, matching the
-- product-image / brand-logo policy in 0010 / 0008: bytes live outside
-- Postgres, DB stores the safe URL). NULL for legacy rows.
-- ============================================================================

-- ---- Reference table: gender_audiences (closed set, migration-managed) ----
CREATE TABLE IF NOT EXISTS gender_audiences (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gender_audiences_code_not_blank CHECK (length(btrim(code)) > 0),
  CONSTRAINT gender_audiences_name_not_blank CHECK (length(btrim(name)) > 0)
);

INSERT INTO gender_audiences (code, name) VALUES
  ('women',  'Women'),
  ('men',    'Men'),
  ('unisex', 'Unisex')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE gender_audiences IS 'Closed set of storefront gender/audience values. Managed by migrations only (reference data); the app reads it, never writes it.';

-- ---- Join table: product_gender_audiences ----
CREATE TABLE IF NOT EXISTS product_gender_audiences (
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  gender_audience_id TEXT NOT NULL REFERENCES gender_audiences(code) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, gender_audience_id),
  CONSTRAINT product_gender_audiences_ref_not_blank CHECK (length(btrim(gender_audience_id)) > 0)
);

-- Back the two access patterns:
--   - "which audiences does THIS product have" (listing serialization)
--   - "which products are in audience X" (storefront filter, facet, showcase)
CREATE INDEX IF NOT EXISTS product_gender_audiences_audience_idx
  ON product_gender_audiences (gender_audience_id);
CREATE INDEX IF NOT EXISTS product_gender_audiences_product_idx
  ON product_gender_audiences (product_id);

COMMENT ON TABLE product_gender_audiences IS 'Many-to-many between products and gender audiences. A product may belong to any number of audiences (women / men / unisex). This is the authoritative model for gender filtering — see 0011 header. ON DELETE CASCADE from products: a product''s audience links cannot outlive it.';

-- Backfill join rows from the legacy single-column value (idempotent).
INSERT INTO product_gender_audiences (product_id, gender_audience_id)
SELECT p.id, p.gender
FROM products p
WHERE p.gender IS NOT NULL
  AND p.gender IN ('women', 'men', 'unisex')
  AND NOT EXISTS (
    SELECT 1 FROM product_gender_audiences pga
    WHERE pga.product_id = p.id AND pga.gender_audience_id = p.gender
  );

-- ---- Category imagery ----
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_image_url_not_blank;
ALTER TABLE categories
  ADD CONSTRAINT categories_image_url_not_blank
    CHECK (image_url IS NULL OR length(btrim(image_url)) > 0);

COMMENT ON COLUMN categories.image_url IS 'Object-storage-style URL or absolute HTTPS image for the category. NULL when unset. Stored as a URL only (bytes live outside Postgres) — same policy as product_images / brand_logos.';

-- ---- Grants ----
-- The app role needs INSERT/DELETE on the join table to write audiences
-- transactionally (admin write path). gender_audiences is reference data:
-- SELECT-only (migration-managed). categories already has SELECT/INSERT/UPDATE
-- from the 0007 baseline, which covers the new image_url column (table-level
-- grants), so no per-column grant is needed there.
GRANT SELECT ON gender_audiences TO voguevibe_app_role;
GRANT SELECT, INSERT, DELETE ON product_gender_audiences TO voguevibe_app_role;
