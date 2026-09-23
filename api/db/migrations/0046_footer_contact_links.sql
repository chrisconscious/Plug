-- ============================================================================
-- Migration 0046: Footer social/contact links
-- ============================================================================
-- A genuinely new feature — no existing table covers "which social/contact
-- channels does the footer show and what are their values." Deliberately a
-- small, fixed-platform table (a CHECK-constrained enum of exactly the six
-- channels this feature specifies) rather than a fully generic "add any
-- platform" system: the requirement is explicit about exactly which
-- channels are wanted (Instagram, TikTok, Facebook, Phone, WhatsApp,
-- Email) and explicit about which are NOT wanted anymore (Pinterest,
-- YouTube, X/Twitter) — a wide-open platform field would make it
-- possible to accidentally recreate the very thing being removed.
--
-- One row per platform (not one row per link an admin might add), since
-- there is exactly one Instagram/TikTok/Facebook/phone/WhatsApp/email
-- value for the whole site, not a list. active lets an admin hide a
-- channel without losing the value they'd already entered (e.g.
-- temporarily pausing WhatsApp support without retyping the number
-- later) — this is the same "don't delete content just to hide it"
-- reasoning already used for announcements/hero slides/attribute options.

CREATE TABLE IF NOT EXISTS footer_contact_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      TEXT NOT NULL UNIQUE
                CHECK (platform IN ('instagram', 'tiktok', 'facebook', 'phone', 'whatsapp', 'email')),
  value         TEXT,                     -- URL, phone number, or email address depending on platform; NULL/blank = not yet configured
  active        BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT footer_contact_links_value_not_blank CHECK (value IS NULL OR length(btrim(value)) > 0),
  -- A channel cannot be turned on with nothing configured — this is what
  -- makes "don't show a dead icon" a real guarantee rather than a
  -- frontend convention that could be bypassed by a stray API call.
  CONSTRAINT footer_contact_links_active_requires_value CHECK (active = false OR value IS NOT NULL)
);

CREATE TRIGGER footer_contact_links_set_updated_at
  BEFORE UPDATE ON footer_contact_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed exactly the six rows this feature specifies, in its own requested
-- display order, all inactive/unconfigured until the admin enters real
-- values — never a placeholder URL, per this whole project's standing
-- "no fabricated destinations" rule.
INSERT INTO footer_contact_links (platform, active, display_order) VALUES
  ('instagram', false, 0),
  ('tiktok',    false, 1),
  ('facebook',  false, 2),
  ('phone',     false, 3),
  ('whatsapp',  false, 4),
  ('email',     false, 5)
ON CONFLICT (platform) DO NOTHING;

CREATE INDEX IF NOT EXISTS footer_contact_links_active_order_idx ON footer_contact_links (active, display_order);

GRANT SELECT, UPDATE ON footer_contact_links TO plug_app_role;

COMMENT ON TABLE footer_contact_links IS 'Admin-managed footer social/contact channels, restricted to exactly Instagram/TikTok/Facebook/Phone/WhatsApp/Email. One fixed row per platform (see the CHECK constraint) — not a free-form list, and Pinterest/YouTube/X are deliberately not valid values here.';
