-- ============================================================================
-- Migration 0026: Homepage promo banner settings.
-- ============================================================================
-- The thin messaging strip above the header ("COMPLIMENTARY DELIVERY...",
-- "NEW SEASON...", "30-DAY EASY RETURNS") was hardcoded static text in
-- PromoBanner.tsx — real, admin-changeable business content (delivery
-- terms, current campaigns, return windows all change over time) with no
-- way to update it short of a code change and redeploy. Same singleton
-- pattern as homepage_brand_settings (migration 0020): one row, an array
-- of messages an admin can edit, add to, remove from, or reorder.

CREATE TABLE IF NOT EXISTS homepage_promo_banner (
  id         SMALLINT PRIMARY KEY DEFAULT 1
             CONSTRAINT homepage_promo_banner_singleton CHECK (id = 1),
  messages   TEXT[] NOT NULL DEFAULT '{}',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER homepage_promo_banner_set_updated_at
  BEFORE UPDATE ON homepage_promo_banner
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prime the singleton with the previously-hardcoded copy, so removing the
-- hardcoded strings from the frontend doesn't change what a visitor sees
-- on day one — only where the content now lives.
INSERT INTO homepage_promo_banner (id, messages, is_active)
VALUES (1, ARRAY[
  'COMPLIMENTARY DELIVERY ON SELECTED ORDERS',
  'NEW SEASON: JUST DROPPED',
  '30-DAY EASY RETURNS'
], true)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE homepage_promo_banner IS 'Singleton admin-editable content for the homepage promo messaging strip. See migration 0020''s header comment for the shared singleton-table rationale.';
