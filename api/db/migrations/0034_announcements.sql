-- ============================================================================
-- Migration 0034: Header announcements
-- ============================================================================
-- Replaces the header's hardcoded promotional text ("FREE SHIPPING ON
-- ORDERS OVER...", "EASY RETURNS", "10% OFF YOUR FIRST ORDER") with a
-- genuinely admin-managed set of messages. Deliberately simple compared
-- to hero_advertisements (migration 0013) — no image, no CTA — since an
-- announcement is a short rotating text line, not a promotional banner.

CREATE TABLE IF NOT EXISTS announcements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message       TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT announcements_message_not_blank CHECK (btrim(message) <> '')
);

CREATE TRIGGER announcements_set_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS announcements_active_order_idx ON announcements (active, display_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON announcements TO plug_app_role;

COMMENT ON TABLE announcements IS 'Admin-managed header announcement bar messages — replaces the previously hardcoded "FREE SHIPPING.../EASY RETURNS/10% OFF" text with real, editable content.';
