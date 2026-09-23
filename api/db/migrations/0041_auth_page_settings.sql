-- ============================================================================
-- Migration 0041: Auth page settings
-- ============================================================================
-- Singleton row (id = 1) making the login/register page's left-panel
-- content (headline, subtitle, background image) admin-editable instead of
-- hardcoded. Modelled on migration 0029 (platform_settings) and 0034
-- (announcements) — simple text fields plus a nullable background image URL
-- stored via the media pipeline. The background image replaces the current
-- CSS gradient when present; when null the gradient is kept.

CREATE TABLE IF NOT EXISTS auth_page_settings (
  id                    UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',
  background_image_url  TEXT,
  login_headline        TEXT NOT NULL DEFAULT 'FASHION THAT DEFINES YOU',
  login_subtitle        TEXT NOT NULL DEFAULT 'Discover premium styles curated for you.',
  register_headline     TEXT NOT NULL DEFAULT 'BECOME A MEMBER',
  register_subtitle     TEXT NOT NULL DEFAULT 'Discover premium styles curated for you.',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID,
  CONSTRAINT auth_page_settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000001')
);

CREATE TRIGGER auth_page_settings_set_updated_at
  BEFORE UPDATE ON auth_page_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON auth_page_settings TO plug_app_role;

-- Seed the singleton row so the public endpoint always returns a result.
INSERT INTO auth_page_settings (id) VALUES ('00000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;

COMMENT ON TABLE auth_page_settings IS 'Singleton admin-editable content for the login/register page left panel (headlines, subtitle, background image).'