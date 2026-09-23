-- ============================================================================
-- Migration 0036: Payment method instructions
-- ============================================================================
-- payment_number already covers the simple "send payment to this number"
-- case (and the checkout page already shows it with a generic hint). This
-- adds an OPTIONAL free-text field for anything beyond that — a reference
-- code to include, a bank transfer's account name, multi-step instructions
-- — without forcing every payment method to have one. NULL means "use the
-- existing generic hint", so every current row is unaffected.

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS instructions TEXT;

ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_instructions_not_blank;
ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_instructions_not_blank
    CHECK (instructions IS NULL OR length(btrim(instructions)) > 0);

COMMENT ON COLUMN payment_methods.instructions IS 'Optional free-text payment instructions shown to the customer at checkout instead of the generic "send payment to the number above" hint. NULL (the default for every existing row) falls back to that generic hint.';
