-- ============================================================================
-- Migration 0020: Brand logo section settings (storefront brand marquee)
-- ============================================================================
-- Idempotent-safe. Adds a single-row configuration table driving the homepage
-- "Shop by brands" logo marquee. Today it carries one setting — the autoplay
-- drift speed (slow/medium/fast) — so an administrator can change how quickly
-- the brand logos move without touching code. The single-row shape (a fixed
-- `id = 1` guard) is deliberate: this is a singleton config, not a list, so
-- there is exactly one row that the app reads and upserts.
--
-- Granting follows the 0007/0013 convention: new tables must get an explicit
-- app-role grant; the readonly role inherits SELECT via the 0007 default.

CREATE TABLE IF NOT EXISTS homepage_brand_settings (
  id              SMALLINT PRIMARY KEY DEFAULT 1
                  CONSTRAINT homepage_brand_settings_singleton CHECK (id = 1),
  brand_logo_speed TEXT NOT NULL DEFAULT 'medium'
                  CONSTRAINT brand_logo_speed_allowed CHECK (brand_logo_speed IN ('slow', 'medium', 'fast')),
  updated_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER homepage_brand_settings_set_updated_at
  BEFORE UPDATE ON homepage_brand_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prime the singleton with the shipped default (MEDIUM).
INSERT INTO homepage_brand_settings (id, brand_logo_speed)
VALUES (1, 'medium')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON homepage_brand_settings TO voguevibe_app_role;