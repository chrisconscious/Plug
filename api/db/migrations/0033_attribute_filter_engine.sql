-- ============================================================================
-- Migration 0033: Dynamic category-specific attribute/filter engine (foundation)
-- ============================================================================
-- This is a genuinely new subsystem, not an extension of the existing
-- product-filter.repo.ts / listFilteredProducts machinery — that system
-- handles a FIXED set of dimensions (size, color, brand, price, gender
-- audience) with dynamic VALUES. This migration is for the opposite
-- problem: an admin-defined, fully dynamic set of DIMENSIONS themselves
-- (e.g. "Fit" for Jeans, "Neckline" for T-Shirts), each with its own
-- admin-defined options, assignable per-category with no code change.
--
-- Deliberately named "attribute", not "filter", throughout — this
-- codebase's existing vocabulary already uses "filter" for the
-- size/color/brand/price system above; reusing that word here would
-- make every future conversation about "the filter system" ambiguous
-- about which one is meant. This distinction is also explicit product
-- guidance for this feature: attributes describe what a product IS
-- (Fit = Baggy), separate from — and not to be confused with —
-- PRODUCT VARIANTS (size/color, which this app already models as real
-- purchasable SKUs via product_variants, not attributes).
--
-- Schema:
--   attribute_groups            (e.g. "Fit", "Neckline", "Rise")
--   attribute_group_categories  which categories a group applies to (M:N)
--   attribute_options           (e.g. "Slim", "Baggy", "Straight")
--   product_attribute_values    which options a product has (M:N)
--
-- Additive only — creates new tables, touches nothing existing.

CREATE TABLE IF NOT EXISTS attribute_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  -- Only the two types this feature's own scope calls for building now
  -- (see its guidance: "do not implement unnecessary filter types if not
  -- required immediately, but architect the system so it can scale").
  -- RANGE/NUMBER/BOOLEAN are real, anticipated future values for this
  -- column — adding one later is a CHECK-constraint update, not a
  -- redesign, precisely because selection_type is already its own
  -- column rather than assumed.
  selection_type TEXT NOT NULL DEFAULT 'multi_select'
                 CHECK (selection_type IN ('multi_select', 'single_select')),
  active         BOOLEAN NOT NULL DEFAULT true,
  display_order  INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attribute_groups_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT attribute_groups_slug_not_blank CHECK (btrim(slug) <> '')
);

CREATE TRIGGER attribute_groups_set_updated_at
  BEFORE UPDATE ON attribute_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS attribute_groups_active_order_idx ON attribute_groups (active, display_order);

-- Which categories a group applies to — a group like "Fit" can be shared
-- across Jeans AND Trousers without being duplicated (this feature's own
-- explicit requirement: "Avoid duplicate filter groups if the same
-- filter is useful across multiple categories").
CREATE TABLE IF NOT EXISTS attribute_group_categories (
  attribute_group_id UUID NOT NULL REFERENCES attribute_groups(id) ON DELETE CASCADE,
  category_id         UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (attribute_group_id, category_id)
);
-- Composite PK above already lets Postgres use it as an index for
-- attribute_group_id-first lookups; this second index supports the
-- other direction (given a category, which groups apply to it).
CREATE INDEX IF NOT EXISTS attribute_group_categories_category_idx ON attribute_group_categories (category_id);

CREATE TABLE IF NOT EXISTS attribute_options (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_group_id  UUID NOT NULL REFERENCES attribute_groups(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT true,
  display_order       INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attribute_options_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT attribute_options_slug_not_blank CHECK (btrim(slug) <> ''),
  -- Slug uniqueness is scoped to the group, not global — "Slim" can exist
  -- as an option under both "Fit" (Jeans) and a differently-scoped group
  -- without a global collision.
  CONSTRAINT attribute_options_unique_slug_per_group UNIQUE (attribute_group_id, slug)
);

CREATE TRIGGER attribute_options_set_updated_at
  BEFORE UPDATE ON attribute_options
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS attribute_options_group_active_order_idx ON attribute_options (attribute_group_id, active, display_order);

-- Which options a product has (e.g. Product X -> Fit=Baggy, Color has its
-- own real variant system already and is NOT modeled here — see this
-- migration's header comment on attributes vs. variants).
CREATE TABLE IF NOT EXISTS product_attribute_values (
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_option_id UUID NOT NULL REFERENCES attribute_options(id) ON DELETE RESTRICT,
  PRIMARY KEY (product_id, attribute_option_id)
);
-- RESTRICT (not CASCADE) on attribute_option_id: deleting an option that's
-- still assigned to real products should fail loudly and force an
-- explicit unassign-first step, not silently strip attributes off
-- products — the same RESTRICT-vs-CASCADE reasoning already used
-- elsewhere in this schema (e.g. brands/categories on products).
CREATE INDEX IF NOT EXISTS product_attribute_values_option_idx ON product_attribute_values (attribute_option_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON attribute_groups TO plug_app_role;
GRANT SELECT, INSERT, DELETE ON attribute_group_categories TO plug_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON attribute_options TO plug_app_role;
GRANT SELECT, INSERT, DELETE ON product_attribute_values TO plug_app_role;

COMMENT ON TABLE attribute_groups IS 'Admin-defined product characteristic dimensions (e.g. "Fit", "Neckline") — see this migration''s header for why "attribute" rather than "filter".';
COMMENT ON TABLE attribute_options IS 'Admin-defined values within a group (e.g. "Slim", "Baggy" under "Fit"). New options require zero code changes to become available.';
COMMENT ON TABLE attribute_group_categories IS 'Which categories a given attribute group applies to — a group is defined once and can be shared across multiple categories (e.g. "Fit" on both Jeans and Trousers) rather than duplicated per category.';
COMMENT ON TABLE product_attribute_values IS 'Which attribute option(s) a specific product has. NOT the same as product_variants (real purchasable size/color combinations) — see this migration''s header comment.';
