-- ============================================================================
-- Migration 0058: Product search keywords + a full product search document
-- ============================================================================
--
-- 1. products.keywords — admin-entered search terms ("black sneakers",
--    "gym shoes"). Kept separate from products.tags on purpose: tags drive
--    collection pages and the collection facet, so search-only words stored
--    there would turn into collections.
--
-- 2. product_search — one weighted tsvector per product built from everything
--    a shopper might type: name, keywords, brand, category (and its parent),
--    attribute options, variant colours and sizes, audiences (men/women),
--    lifestyles, collection tags, SKU and descriptions. The old
--    products.search_vector only covered the name, so "nike shoes" (brand +
--    category) or "oversized" (an attribute) found nothing.
--
--    It lives in its own table rather than on products so that refreshing it
--    (e.g. when a brand is renamed or a variant colour is added) never touches
--    products.updated_at or fires product triggers.
--
--    Weights: A = name + keywords + SKU, B = brand + category, C = attributes,
--    colours, sizes, audiences, lifestyles, tags, D = descriptions. Each text
--    is indexed with both the 'english' config (stems: shoes -> shoe,
--    running -> run) and 'simple' (keeps the literal word, so a half-typed
--    prefix like "runn" still matches "running").
--
--    Triggers keep it current; products.search_vector is left in place
--    (unused by the new search) so nothing that may still read it breaks.

ALTER TABLE products ADD COLUMN IF NOT EXISTS keywords TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS product_search (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  document   TSVECTOR NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_search_document_gin_idx ON product_search USING GIN (document);

-- Both configs, same weight, for one piece of text.
CREATE OR REPLACE FUNCTION product_search_vec(txt TEXT, w "char") RETURNS TSVECTOR
LANGUAGE sql IMMUTABLE AS $$
  SELECT setweight(to_tsvector('english', coalesce(txt, '')), w)
      || setweight(to_tsvector('simple', coalesce(txt, '')), w)
$$;

CREATE OR REPLACE FUNCTION refresh_product_search(pid UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  doc TSVECTOR;
BEGIN
  SELECT
      product_search_vec(p.name, 'A')
   || product_search_vec(array_to_string(p.keywords, ' '), 'A')
   || product_search_vec(coalesce(p.sku, ''), 'A')
   || product_search_vec(coalesce(b.name, ''), 'B')
   || product_search_vec(coalesce(c.name, '') || ' ' || coalesce(pc.name, ''), 'B')
   || product_search_vec(coalesce((
        SELECT string_agg(ao.name, ' ')
          FROM product_attribute_values pav
          JOIN attribute_options ao ON ao.id = pav.attribute_option_id AND ao.active = true
         WHERE pav.product_id = p.id), ''), 'C')
   || product_search_vec(coalesce((
        SELECT string_agg(DISTINCT pv.color || ' ' || pv.size, ' ')
          FROM product_variants pv WHERE pv.product_id = p.id), ''), 'C')
   || product_search_vec(coalesce((
        SELECT string_agg(ga.code || ' ' || ga.name, ' ')
          FROM product_gender_audiences pga
          JOIN gender_audiences ga ON ga.code = pga.gender_audience_id
         WHERE pga.product_id = p.id), ''), 'C')
   || product_search_vec(coalesce((
        SELECT string_agg(l.name, ' ')
          FROM product_lifestyles pl
          JOIN lifestyles l ON l.id = pl.lifestyle_id AND l.active = true
         WHERE pl.product_id = p.id), ''), 'C')
   || product_search_vec(array_to_string(p.tags, ' '), 'C')
   || product_search_vec(coalesce(p.short_description, '') || ' ' || coalesce(p.full_description, ''), 'D')
    INTO doc
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
   WHERE p.id = pid;

  IF doc IS NULL THEN
    RETURN; -- product no longer exists (the FK cascade removes its row)
  END IF;

  INSERT INTO product_search (product_id, document, updated_at)
  VALUES (pid, doc, now())
  ON CONFLICT (product_id) DO UPDATE SET document = EXCLUDED.document, updated_at = now();
END;
$$;

-- ---- Triggers -------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_product_search_from_product() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_product_search(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_search_on_product ON products;
CREATE TRIGGER product_search_on_product
  AFTER INSERT OR UPDATE OF name, keywords, sku, brand_id, category_id, tags, short_description, full_description
  ON products FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_product();

-- Child tables that carry product_id: refresh the affected product(s).
CREATE OR REPLACE FUNCTION trg_product_search_from_child() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM refresh_product_search(OLD.product_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
    PERFORM refresh_product_search(NEW.product_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_search_on_variant ON product_variants;
CREATE TRIGGER product_search_on_variant
  AFTER INSERT OR DELETE OR UPDATE OF color, size, product_id
  ON product_variants FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_child();

DROP TRIGGER IF EXISTS product_search_on_attribute_value ON product_attribute_values;
CREATE TRIGGER product_search_on_attribute_value
  AFTER INSERT OR DELETE OR UPDATE
  ON product_attribute_values FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_child();

DROP TRIGGER IF EXISTS product_search_on_audience ON product_gender_audiences;
CREATE TRIGGER product_search_on_audience
  AFTER INSERT OR DELETE OR UPDATE
  ON product_gender_audiences FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_child();

DROP TRIGGER IF EXISTS product_search_on_lifestyle_link ON product_lifestyles;
CREATE TRIGGER product_search_on_lifestyle_link
  AFTER INSERT OR DELETE OR UPDATE
  ON product_lifestyles FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_child();

-- Renaming a brand / category / attribute option / lifestyle changes the
-- words of every product that uses it.
CREATE OR REPLACE FUNCTION trg_product_search_from_brand() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_product_search(p.id) FROM products p WHERE p.brand_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_search_on_brand ON brands;
CREATE TRIGGER product_search_on_brand
  AFTER UPDATE OF name ON brands FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_brand();

CREATE OR REPLACE FUNCTION trg_product_search_from_category() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- The category itself and its direct children (a child's document carries
  -- its parent's name too).
  PERFORM refresh_product_search(p.id)
     FROM products p
     JOIN categories c ON c.id = p.category_id
    WHERE c.id = NEW.id OR c.parent_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_search_on_category ON categories;
CREATE TRIGGER product_search_on_category
  AFTER UPDATE OF name, parent_id ON categories FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_category();

CREATE OR REPLACE FUNCTION trg_product_search_from_attribute_option() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_product_search(pav.product_id)
     FROM product_attribute_values pav WHERE pav.attribute_option_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_search_on_attribute_option ON attribute_options;
CREATE TRIGGER product_search_on_attribute_option
  AFTER UPDATE OF name, active ON attribute_options FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_attribute_option();

CREATE OR REPLACE FUNCTION trg_product_search_from_lifestyle() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_product_search(pl.product_id)
     FROM product_lifestyles pl WHERE pl.lifestyle_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_search_on_lifestyle ON lifestyles;
CREATE TRIGGER product_search_on_lifestyle
  AFTER UPDATE OF name, active ON lifestyles FOR EACH ROW EXECUTE FUNCTION trg_product_search_from_lifestyle();

-- ---- Backfill every existing product ---------------------------------------
SELECT refresh_product_search(id) FROM products;
