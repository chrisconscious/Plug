-- ============================================================================
-- Migration 0019: Shop by Lifestyle taxonomy
-- ============================================================================
-- Adds the "Lifestyle" merchandising taxonomy that powers the storefront
-- "Shop by Lifestyle" section and the /lifestyle/:slug detail pages.
--
--   lifestyles             the taxonomy (Super Admin-managed CRUD via
--                           `lifestyles.manage`; users never edit it)
--   product_lifestyles     join: a product can belong to ANY number of
--                           lifestyles (e.g. "Campus Life" AND "Night Out").
--
-- Semantics (per the feature spec):
--   * Lifestyle = "where / when you wear it"; Category = "what it is".
--     They are deliberately separate taxonomies; a lifestyle page narrows the
--     existing product filter engine, it never re-defines categories.
--   * Products stay ONE `products` row (no per-lifestyle product clone);
--     membership is purely this join table.
--   * The DB is the delete backstop: a lifestyle with assigned products is
--     RESTRICT-ed from deletion (surfaced as a friendly message by the delete
--     safeguard in the service). Products may still be removed freely
--     (CASCADE keeps joins from outliving their product).
--   * An active lifestyle MUST have a hero image (CHECK constraint) so the
--     storefront cards never render a broken/placeholder visual — the admin
--     UI enforces the same rule, the CHECK is the schema-level backstop.
--
-- Image policy mirrors hero_advertisements (0013): bytes live outside
-- Postgres (src/lib/storage); this row stores the public URL plus the
-- magic-byte-sniffed content type / dimensions from the validated upload
-- pipeline (src/lib/security/image.ts).
-- ============================================================================

-- ---- Reference table: lifestyles ----
CREATE TABLE IF NOT EXISTS lifestyles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT NOT NULL,
  name               TEXT NOT NULL,
  short_description  TEXT,
  hero_image_url     TEXT,
  storage_key        TEXT,
  content_type       TEXT,
  size_bytes         INTEGER,
  width              INTEGER,
  height             INTEGER,
  active             BOOLEAN NOT NULL DEFAULT false,
  display_order      INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lifestyles_slug_unique UNIQUE (slug),
  CONSTRAINT lifestyles_slug_not_blank CHECK (length(btrim(slug)) > 0),
  CONSTRAINT lifestyles_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT lifestyles_image_not_blank CHECK (hero_image_url IS NULL OR length(btrim(hero_image_url)) > 0),
  CONSTRAINT lifestyles_display_order_non_negative CHECK (display_order >= 0),
  CONSTRAINT lifestyles_active_requires_image CHECK (NOT active OR (hero_image_url IS NOT NULL AND length(btrim(hero_image_url)) > 0))
);

DROP TRIGGER IF EXISTS lifestyles_set_updated_at ON lifestyles;
CREATE TRIGGER lifestyles_set_updated_at BEFORE UPDATE ON lifestyles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS lifestyles_active_order_idx ON lifestyles (active, display_order);

COMMENT ON TABLE lifestyles IS 'Admin-owned merchandising taxonomy ("where/when you wear it") that powers the Shop by Lifestyle storefront section and /lifestyle/:slug pages. A lifestyle is distinct from a category ("what it is"). Managed exclusively by Super Admins via the lifestyles.manage permission; storefront consumers only ever read active rows.';
COMMENT ON COLUMN lifestyles.hero_image_url IS 'Public URL for the lifestyle''s real hero/card image (uploaded through the validated image pipeline). Active lifestyles always have one -- enforced by CHECK. Bytes live outside Postgres (see src/lib/storage).';
COMMENT ON COLUMN lifestyles.storage_key IS 'Object-storage key of the uploaded hero image, when it went through the app''s upload pipeline. NULL for any row whose image was not uploaded via the app (e.g. future imports).';
COMMENT ON COLUMN lifestyles.active IS 'Only active lifestyles are discoverable on the storefront (homepage section + /lifestyle/:slug). Super Admins toggle this; inactive rows remain fully intact for later reactivation.';
COMMENT ON COLUMN lifestyles.display_order IS 'Sort order for the storefront lifestyle presentation (ascending). Stable per-row ordering alongside created_at for ties.';

-- ---- Join table: product_lifestyles ----
CREATE TABLE IF NOT EXISTS product_lifestyles (
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lifestyle_id  UUID NOT NULL REFERENCES lifestyles(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, lifestyle_id)
);

-- Back the two access patterns:
--   - "which lifestyles does THIS product belong to" (listing serialization)
--   - "which products are in lifestyle X" (storefront filter/facet/showcase)
CREATE INDEX IF NOT EXISTS product_lifestyles_lifestyle_idx
  ON product_lifestyles (lifestyle_id);
CREATE INDEX IF NOT EXISTS product_lifestyles_product_idx
  ON product_lifestyles (product_id);

COMMENT ON TABLE product_lifestyles IS 'Many-to-many between products and lifestyles. A product may belong to any number of lifestyles. ON DELETE CASCADE from products: joins cannot outlive their product. ON DELETE RESTRICT from lifestyles: a lifestyle with assigned products cannot be deleted (the delete safeguard surfaces this as a friendly message).';

-- ---- Grants ----
-- The app role fully manages lifestyles (admin CRUD + upload pipeline) and
-- reads/writes the join (admin product form + storefront filters). Classic
-- read-only storefront access is implied by the same role.
GRANT SELECT, INSERT, UPDATE, DELETE ON lifestyles TO voguevibe_app_role;
GRANT SELECT, INSERT, DELETE ON product_lifestyles TO voguevibe_app_role;