-- ============================================================================
-- Migration 0047: Delivery-location transport fees + COD message
-- ============================================================================
-- Extends platform_settings (the existing site-wide config singleton)
-- rather than a new table, since this is exactly the same kind of
-- "one site-wide value, admin-editable" configuration already living
-- there (PWA icon, install-prompt toggle, tagline). Two fees is not
-- enough distinct rows to justify a separate table the way
-- footer_contact_links' six fixed platforms was.
--
-- This is a genuine change to the fee MODEL, not just new fields:
-- previously the transport fee was tied to the CASH payment method's own
-- fee_tzs column (payment_methods.fee_tzs), meaning Online Pay orders
-- had zero delivery charge. The new checkout requires the SAME transport
-- fee for a given delivery location regardless of which payment method
-- is chosen — Online Pay now also includes it in the total. See
-- orders.repo.ts's createOrderTransactional for where this is actually
-- applied; payment_methods.fee_tzs is no longer read for this purpose.

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS dar_es_salaam_fee_tzs INTEGER NOT NULL DEFAULT 0
    CHECK (dar_es_salaam_fee_tzs >= 0),
  ADD COLUMN IF NOT EXISTS outside_dar_fee_tzs INTEGER NOT NULL DEFAULT 0
    CHECK (outside_dar_fee_tzs >= 0),
  ADD COLUMN IF NOT EXISTS cod_message TEXT;

ALTER TABLE platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_cod_message_not_blank;
ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_cod_message_not_blank
    CHECK (cod_message IS NULL OR length(btrim(cod_message)) > 0);

-- Which delivery location a completed order actually used, and the exact
-- fee charged for it at that time (fees can change later; an existing
-- order's record must not silently reflect today's rate). Nullable
-- because pre-existing orders were created before delivery locations
-- existed at all — they keep whatever transport_fee_tzs they already
-- have, with no location on record, rather than being backfilled with a
-- guess.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_location TEXT
    CHECK (delivery_location IS NULL OR delivery_location IN ('dar_es_salaam', 'outside_dar'));

COMMENT ON COLUMN platform_settings.dar_es_salaam_fee_tzs IS 'Transport fee (whole TZS) charged for delivery within Dar es Salaam, regardless of payment method chosen.';
COMMENT ON COLUMN platform_settings.outside_dar_fee_tzs IS 'Transport fee (whole TZS) charged for delivery outside Dar es Salaam, regardless of payment method chosen.';
COMMENT ON COLUMN platform_settings.cod_message IS 'Admin-editable message shown when a customer selects Cash on Delivery at checkout (e.g. explaining the transport fee is paid upfront, the rest on delivery). NULL falls back to a sensible default in the service layer, never a hardcoded frontend string.';
COMMENT ON COLUMN orders.delivery_location IS 'Which delivery location the customer selected at checkout (migration 0047). NULL for orders placed before this existed.';
