-- ============================================================================
-- Migration 0038: PWA settings
-- ============================================================================
-- Extends the existing platform_settings singleton (migration 0029) rather
-- than creating a separate PWASettings table — this is exactly the same
-- kind of "platform identity" configuration as the logo/favicon it already
-- manages, and the manifest/install-card need to read the SAME row those
-- already come from, not a second source of truth for platform branding.
--
-- Deliberately minimal: only what the install experience actually needs
-- (an icon, and an on/off switch). Theme color / background color are NOT
-- added as separate admin settings — they're derived from the existing
-- fixed brand palette in the manifest route itself, since introducing more
-- configurable knobs than the feature genuinely requires is exactly what
-- this feature's own brief warns against ("Only add settings that are
-- genuinely useful").

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS pwa_icon_media_id UUID REFERENCES media(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pwa_install_prompt_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN platform_settings.pwa_icon_media_id IS 'The uploaded app icon used by the PWA manifest and install card. NULL falls back to the existing platform logo, then to a generic in-app placeholder — never a hardcoded old-brand icon.';
COMMENT ON COLUMN platform_settings.pwa_install_prompt_enabled IS 'Superadmin on/off switch for the custom install card. Even when true, the card only ever shows when the browser itself reports the PWA is actually installable — this never forces the card to appear.';
