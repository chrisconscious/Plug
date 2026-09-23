-- ============================================================================
-- Migration 0009: Product filtering support
--   - products.gender                 : women / men / unisex (nullable)
--   - products.compare_at_price_cents : original/compare-at price for
--                                       discounts; nullable; must be >= price
--   - products.tags                   : lightweight collection/tag set for
--                                       New In / Trending / Campus etc.
-- ============================================================================
-- The app role gets table-level SELECT/UPDATE on products (0007), which covers
-- new columns automatically, so no per-column GRANT is needed here.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS compare_at_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Gender names a small closed set; NULL = unset, not "any".
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_gender_check;
ALTER TABLE products
  ADD CONSTRAINT products_gender_check
    CHECK (gender IS NULL OR gender IN ('women', 'men', 'unisex'));

-- A compare-at price is only meaningful if it is strictly above the current
-- price (that is what makes the product "on sale"). NULL = not on sale.
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_compare_at_price_check;
ALTER TABLE products
  ADD CONSTRAINT products_compare_at_price_check
    CHECK (compare_at_price_cents IS NULL OR compare_at_price_cents >= price_cents);

-- Indexes to back the new filter columns on the active-product subset.
-- price_cents: used by min/max price filters, price sorts, and the
--              percentiles behind quick price ranges.
CREATE INDEX IF NOT EXISTS products_active_price_idx
  ON products (price_cents) WHERE active = true;
-- tags: "X products in collection <tag>" is products.tags @> array[tag]
CREATE INDEX IF NOT EXISTS products_gin_tags_idx
  ON products USING GIN (tags) WHERE active = true;

-- Updating tags/gender/compare_at triggers the updated_at bump (already wired).
COMMENT ON COLUMN products.gender IS 'Target gender of the product: women / men / unisex. NULL means the product is not currently assigned a gender filter value.';
COMMENT ON COLUMN products.compare_at_price_cents IS 'The pre-discount (strikethrough) price in minor units. When present and > price_cents the product is "on sale". NULL when not on sale.';
COMMENT ON COLUMN products.tags IS 'Lightweight collection/tag set used by storefront listing pages, e.g. {"new","trending","campus"}.';
