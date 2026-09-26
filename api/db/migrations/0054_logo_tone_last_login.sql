-- ============================================================================
-- Migration 0054: Brand logo tone + user last-login
-- ============================================================================
--
-- brand_logos.tone
--   'light' = a light/white mark (on transparency) that would vanish on the
--   storefront's light surfaces; the storefront renders it with a dark
--   treatment there. 'dark' = render as uploaded. NULL = not analyzed yet
--   (rendered as uploaded). Detected automatically on upload from the image
--   pixels (see api/src/lib/security/image-tone.ts) and overridable by an
--   admin. The uploaded file itself is never modified.
--
-- users.last_login_at
--   Set on every successful sign-in (password, phone or MFA completion) so
--   the same customer record is visibly recognised across visits.

ALTER TABLE brand_logos ADD COLUMN IF NOT EXISTS tone TEXT;
ALTER TABLE brand_logos DROP CONSTRAINT IF EXISTS brand_logos_tone_valid;
ALTER TABLE brand_logos ADD CONSTRAINT brand_logos_tone_valid CHECK (tone IS NULL OR tone IN ('light', 'dark'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

COMMENT ON COLUMN brand_logos.tone IS 'light | dark | NULL (unknown). Auto-detected on upload, admin-overridable. Presentation hint only — the stored file is never altered.';
COMMENT ON COLUMN users.last_login_at IS 'Time of the most recent successful sign-in.';
