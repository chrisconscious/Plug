-- ============================================================================
-- Migration 0035: Payment method icon
-- ============================================================================
-- payment_methods already supports everything else the payment-network
-- redesign calls for (name, active/inactive, display order, admin CRUD) —
-- this adds the one genuinely missing piece: an uploadable icon per
-- method. Mirrors categories' image columns (migration 0031): nullable,
-- no "active requires icon" constraint, since every existing payment
-- method already works today with no icon and must keep working
-- unchanged after this migration runs.

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS icon_url TEXT,
  ADD COLUMN IF NOT EXISTS icon_storage_key TEXT;

ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_icon_url_not_blank;
ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_icon_url_not_blank
    CHECK (icon_url IS NULL OR length(btrim(icon_url)) > 0);

COMMENT ON COLUMN payment_methods.icon_url IS 'Public URL for the payment method''s small storefront icon (uploaded through the validated image pipeline). Nullable — existing methods work unchanged without one.';
COMMENT ON COLUMN payment_methods.icon_storage_key IS 'Storage-provider key for the uploaded icon, needed to delete the underlying file on replace/removal.';
