-- ============================================================================
-- Migration 0040: Product page accordion sections
-- ============================================================================
-- Replaces the product detail page's hardcoded, non-expandable labels
-- ("DESCRIPTION", "SIZE & FIT", "SHIPPING & RETURNS") with a globally
-- admin-managed set of accordion sections shown on EVERY product page.
-- An admin (Super Admin → Product Accordion) names each section and writes
-- its body text; the storefront renders them as real expandable accordions.
-- Modelled closely on migration 0034 (announcements) — same shape and
-- permissions: short editable rows plus drag-to-reorder.

CREATE TABLE IF NOT EXISTS product_accordion_sections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_accordion_sections_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT product_accordion_sections_body_not_blank CHECK (btrim(body) <> '')
);

CREATE TRIGGER product_accordion_sections_set_updated_at
  BEFORE UPDATE ON product_accordion_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS product_accordion_sections_active_order_idx
  ON product_accordion_sections (active, display_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON product_accordion_sections TO plug_app_role;

COMMENT ON TABLE product_accordion_sections IS 'Globally admin-managed accordion sections shown on every product detail page — replaces the previously hardcoded "DESCRIPTION / SIZE & FIT / SHIPPING & RETURNS" labels with real, editable, reorderable content.';