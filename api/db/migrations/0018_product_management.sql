-- ============================================================================
-- Migration 0018: Product management — SKU, descriptions, offers & badges
-- ============================================================================
-- Ground-truth findings (see the Product Management spec review) drove these
-- decisions:
--   * compare_at_price_cents (0009) is the single source of truth for a sale;
--     "discount %" is computed server-side from compare_at vs price, never
--     stored — so there is no second price truth to drift.
--   * Sale "live" state is additionally gated by an optional DATE window
--     (offer_start_date..offer_end_date). The window is enforced in queries,
--     not CHECK constraints, because CHECKs must be IMMUTABLE and cannot call
--     now()/CURRENT_DATE (same pattern as hero slides — see 0013).
--   * products.active stays the sole lifecycle flag (Active/Draft/Archived);
--     no parallel `status` column is added.
--   * sku is optional and unique-when-present. Variants get their own sku so
--     a fulfillment/barcode workflow can key on either grain.
--
-- All additions are nullable + additive; existing rows are untouched. The app
-- role's table-level grants (0007) already cover new columns.
-- ----------------------------------------------------------------------------

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS short_description TEXT,
  ADD COLUMN IF NOT EXISTS full_description TEXT,
  ADD COLUMN IF NOT EXISTS badge_text TEXT,
  ADD COLUMN IF NOT EXISTS offer_label TEXT,
  ADD COLUMN IF NOT EXISTS offer_start_date DATE,
  ADD COLUMN IF NOT EXISTS offer_end_date DATE;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_sku_not_blank;
ALTER TABLE products
  ADD CONSTRAINT products_sku_not_blank CHECK (sku IS NULL OR length(btrim(sku)) > 0);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_short_description_not_blank;
ALTER TABLE products
  ADD CONSTRAINT products_short_description_not_blank CHECK (short_description IS NULL OR length(btrim(short_description)) > 0);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_full_description_not_blank;
ALTER TABLE products
  ADD CONSTRAINT products_full_description_not_blank CHECK (full_description IS NULL OR length(btrim(full_description)) > 0);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_badge_text_not_blank;
ALTER TABLE products
  ADD CONSTRAINT products_badge_text_not_blank CHECK (badge_text IS NULL OR length(btrim(badge_text)) > 0);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_offer_label_not_blank;
ALTER TABLE products
  ADD CONSTRAINT products_offer_label_not_blank CHECK (offer_label IS NULL OR length(btrim(offer_label)) > 0);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_offer_date_range_valid;
ALTER TABLE products
  ADD CONSTRAINT products_offer_date_range_valid CHECK (offer_start_date IS NULL OR offer_end_date IS NULL OR offer_start_date <= offer_end_date);

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique_idx
  ON products (sku) WHERE sku IS NOT NULL;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS sku TEXT;

ALTER TABLE product_variants
  DROP CONSTRAINT IF EXISTS product_variants_sku_not_blank;
ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_sku_not_blank CHECK (sku IS NULL OR length(btrim(sku)) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_unique_idx
  ON product_variants (sku) WHERE sku IS NOT NULL;

-- Indexes backing the sale-window queries (compare_at > price AND
-- offer dates covering today) so the storefront sale filter stays fast.
CREATE INDEX IF NOT EXISTS products_active_compare_at_idx
  ON products (price_cents, compare_at_price_cents) WHERE active = true AND compare_at_price_cents IS NOT NULL;

COMMENT ON COLUMN products.sku IS 'Optional unique stock-keeping unit. Unique when present (partial unique index) so the same SKU cannot be reused across products.';
COMMENT ON COLUMN products.short_description IS 'Concise subtitle/lede for cards and search results. NULL allowed — UI falls back to the product name.';
COMMENT ON COLUMN products.full_description IS 'Long-form product body for the detail page (plain text). NULL allowed.';
COMMENT ON COLUMN products.badge_text IS 'Single marketing ribbon shown on cards (e.g. "NEW", "BESTSELLER"). Distinct from tags, which drive collection membership/listing pages.';
COMMENT ON COLUMN products.offer_label IS 'Marketing/campaign label for an active offer (e.g. "Spring 30% off"), displayed near pricing when the sale window is live.';
COMMENT ON COLUMN products.offer_start_date IS 'Optional start of the live sale window (inclusive). NULL = no lower bound. Window logic runs in app code, not CHECKs (CHECK must be IMMUTABLE).';
COMMENT ON COLUMN products.offer_end_date IS 'Optional end of the live sale window (inclusive). NULL = no upper bound.';
COMMENT ON COLUMN product_variants.sku IS 'Optional unique per-variant SKU for barcode/fulfillment workflows. Unique when present.';