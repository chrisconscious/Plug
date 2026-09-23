-- ============================================================================
-- Migration 0003: Catalog — brands, categories, products, variants, images
-- ============================================================================

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT brands_slug_not_blank CHECK (length(btrim(slug)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS brands_slug_unique_idx ON brands (slug);
DROP TRIGGER IF EXISTS brands_set_updated_at ON brands;
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- categories (self-referential for subcategories; NULL parent = top-level)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT categories_not_self_parent CHECK (id IS DISTINCT FROM parent_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_unique_idx ON categories (slug);
CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON categories (parent_id);
DROP TRIGGER IF EXISTS categories_set_updated_at ON categories;
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN categories.parent_id IS 'ON DELETE SET NULL, not CASCADE: deleting a parent category should promote its children to top-level, never silently delete an entire subcategory tree and the products under it.';

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  brand_id      UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  -- Integer minor currency units (cents). Never NUMERIC/FLOAT for this —
  -- see docs/DATABASE.md "Money strategy".
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Generated tsvector for product search (name only, for now — extend to
  -- include brand/category via a join-backed materialized view if search
  -- needs grow beyond simple name matching; see docs/DATABASE.md).
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', name)) STORED,
  CONSTRAINT products_slug_not_blank CHECK (length(btrim(slug)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique_idx ON products (slug);
-- The #1 query pattern (product listing/filtering) is "active products,
-- optionally by brand and/or category" — a partial composite index on the
-- active subset serves it directly and stays small as inactive products
-- accumulate over time.
CREATE INDEX IF NOT EXISTS products_active_brand_category_idx
  ON products (active, brand_id, category_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS products_search_vector_gin_idx ON products USING GIN (search_vector);

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE products IS 'brand_id/category_id use ON DELETE RESTRICT: a brand or category with active products cannot be deleted out from under them — the admin must reassign or deactivate the products first. This is a deliberate safety rail against accidental orphaning, not an oversight.';
COMMENT ON COLUMN products.active IS 'Soft-delete flag. Products are never hard-deleted (see catalog.repo.ts#deleteProduct) because order_items historically reference product_id — see 0005. Hard deletion here would either orphan or (if CASCADEd) destroy past orders'' referential integrity.';

-- ---------------------------------------------------------------------------
-- product_variants — the actual sellable/stockable unit (size x color)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size        TEXT NOT NULL,
  color       TEXT NOT NULL,
  stock_qty   INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  -- Optimistic-concurrency helper column. The PRIMARY inventory-safety
  -- mechanism is `SELECT ... FOR UPDATE` inside the order transaction (see
  -- orders.repo.ts / docs/DATABASE.md "Concurrency strategy"); `version` is
  -- defense in depth for any future code path that reads-then-writes
  -- outside that transaction (e.g. an admin stock-adjustment UI).
  version     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_unique_combo UNIQUE (product_id, size, color)
);

CREATE INDEX IF NOT EXISTS product_variants_product_id_idx ON product_variants (product_id);
-- Supports "low stock" admin views/alerts without a full table scan.
CREATE INDEX IF NOT EXISTS product_variants_low_stock_idx ON product_variants (stock_qty) WHERE stock_qty <= 5;

DROP TRIGGER IF EXISTS product_variants_set_updated_at ON product_variants;
CREATE TRIGGER product_variants_set_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE product_variants IS 'ON DELETE CASCADE from products is intentional: a variant cannot outlive its product, and (unlike orders) nothing needs a variant row to remain after its product is gone — order_items snapshot everything they need (name, brand, price, size, color) at purchase time, see 0005, so historical orders are unaffected by variant/product deletion.';

-- ---------------------------------------------------------------------------
-- product_images
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  alt_text    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_images_url_not_blank CHECK (length(btrim(url)) > 0)
);

-- Product detail pages fetch "this product's images, in order" — the
-- composite index matches that access pattern exactly.
CREATE INDEX IF NOT EXISTS product_images_product_id_position_idx ON product_images (product_id, position);

COMMENT ON TABLE product_images IS 'url stores an object-storage reference (e.g. S3 key or CDN URL), not the image bytes — see docs/ARCHITECTURE.md for the file-storage plan. This table has no updated_at/trigger: images are replaced by delete+insert, not edited in place.';
