-- ============================================================================
-- Migration 0053: Product lifecycle timestamps (publish / archive)
-- ============================================================================
--
-- Until now a product had only `active`, which conflated three different
-- states: a DRAFT that was never published, a live product that was
-- temporarily UNPUBLISHED, and a product the admin DELETED (soft delete also
-- just set active = false). The storefront's "newest" ordering used
-- created_at, so a product drafted on Monday and published on Friday ranked
-- as Monday's — wrong for the homepage "Latest Drop".
--
--   published_at  first time the product went live. Set once by the service
--                 layer on the first inactive -> active transition and never
--                 moved afterwards, so unpublishing/republishing a product
--                 does not make it jump back to the top of Latest Drop.
--   archived_at   set when an admin deletes (archives) a product; cleared on
--                 restore. Archived products are never listed or purchasable,
--                 but their rows stay so order history and audit trails keep
--                 resolving (order_items also snapshot everything, see 0005).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMPTZ;

-- Existing live products were published at some point before this column
-- existed; created_at is the best available approximation.
UPDATE products SET published_at = created_at WHERE active = true AND published_at IS NULL;

-- An archived product is never live.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_archived_not_active;
ALTER TABLE products
  ADD CONSTRAINT products_archived_not_active CHECK (archived_at IS NULL OR active = false);

-- Latest Drop / "newest" storefront ordering over live products only.
CREATE INDEX IF NOT EXISTS products_live_published_idx
  ON products (published_at DESC, created_at DESC)
  WHERE active = true;

-- Admin product management filters by lifecycle state.
CREATE INDEX IF NOT EXISTS products_archived_at_idx ON products (archived_at) WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN products.published_at IS 'First time the product went live (inactive -> active). Drives Latest Drop / newest ordering. Never moved by later unpublish/republish.';
COMMENT ON COLUMN products.archived_at IS 'Set when an admin deletes (archives) the product; NULL otherwise. Archived rows are kept for order history.';
