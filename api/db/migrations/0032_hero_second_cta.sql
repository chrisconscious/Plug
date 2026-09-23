-- ============================================================================
-- Migration 0032: Optional second CTA on hero slides
-- ============================================================================
-- The existing hero_advertisements model (migration 0013) supports exactly
-- one CTA per slide (cta_text/cta_url, both NOT NULL). The homepage hero
-- redesign requires the opening slide to present TWO clear actions ("SHOP
-- MEN" / "SHOP WOMEN") — rather than hardcode a special first slide outside
-- the admin-managed system (which would mean an admin could never actually
-- change that slide's copy/images/links without a code deploy, defeating
-- the entire point of this being a CMS-driven carousel), this extends the
-- existing table with an OPTIONAL second CTA pair. Any slide can now have
-- one or two buttons; the first CTA remains required (unchanged), the
-- second is entirely optional and nullable — existing slides are
-- unaffected (both new columns default to NULL, rendering as before: one
-- button).

ALTER TABLE hero_advertisements
  ADD COLUMN IF NOT EXISTS cta2_text TEXT,
  ADD COLUMN IF NOT EXISTS cta2_url TEXT;

-- Mirrors the existing hero_cta_text_not_blank/hero_cta_url_not_blank
-- constraints on the first CTA: if a second CTA is configured at all, both
-- its text and URL must actually be present and non-blank — a slide can
-- have ZERO or TWO second-CTA fields set, never exactly one silently
-- rendering a broken half-configured button.
ALTER TABLE hero_advertisements
  DROP CONSTRAINT IF EXISTS hero_cta2_both_or_neither;
ALTER TABLE hero_advertisements
  ADD CONSTRAINT hero_cta2_both_or_neither
    CHECK ((cta2_text IS NULL) = (cta2_url IS NULL));

ALTER TABLE hero_advertisements
  DROP CONSTRAINT IF EXISTS hero_cta2_text_not_blank;
ALTER TABLE hero_advertisements
  ADD CONSTRAINT hero_cta2_text_not_blank
    CHECK (cta2_text IS NULL OR length(btrim(cta2_text)) > 0);

ALTER TABLE hero_advertisements
  DROP CONSTRAINT IF EXISTS hero_cta2_url_not_blank;
ALTER TABLE hero_advertisements
  ADD CONSTRAINT hero_cta2_url_not_blank
    CHECK (cta2_url IS NULL OR length(btrim(cta2_url)) > 0);

COMMENT ON COLUMN hero_advertisements.cta2_text IS 'Optional second call-to-action label (e.g. "SHOP WOMEN" alongside a first CTA of "SHOP MEN"). NULL means this slide has only one button, same as every slide before this migration.';
COMMENT ON COLUMN hero_advertisements.cta2_url IS 'Optional second call-to-action destination — internal path or absolute URL, same validation/rendering rules as cta_url.';
