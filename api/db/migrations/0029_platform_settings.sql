-- ============================================================================
-- Migration 0029: Platform branding settings (dynamic site identity)
-- ============================================================================
-- Idempotent-safe. Singleton config table (same convention as 0020's
-- homepage_brand_settings — see that migration's comment for the reasoning
-- behind the `id = 1` guard) that decouples customer-facing platform
-- identity (name, logo, favicon, tagline) from hardcoded values so a
-- Super Admin can change them without a code deploy.
--
-- The logo itself is NOT stored here as binary/base64 data — it's stored
-- through the EXISTING media/storage pipeline (see media.repo.ts,
-- MediaService) exactly like a product or hero image, and this table just
-- holds a reference (logo_media_id) to that media row. This deliberately
-- reuses the existing upload/validation/storage-provider architecture
-- rather than creating a second one.
--
-- platform_name defaults to 'PLUG' — the current platform identity —
-- while remaining fully editable through the settings this table backs,
-- per the requirement that the name be configurable, not hardcoded.

CREATE TABLE IF NOT EXISTS platform_settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1
                    CONSTRAINT platform_settings_singleton CHECK (id = 1),
  platform_name     TEXT NOT NULL DEFAULT 'PLUG'
                    CONSTRAINT platform_name_not_blank CHECK (btrim(platform_name) <> ''),
  tagline           TEXT,
  logo_media_id     UUID REFERENCES media(id) ON DELETE SET NULL,
  favicon_media_id  UUID REFERENCES media(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER platform_settings_set_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prime the singleton with the shipped default.
INSERT INTO platform_settings (id, platform_name)
VALUES (1, 'PLUG')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON platform_settings TO voguevibe_app_role;
