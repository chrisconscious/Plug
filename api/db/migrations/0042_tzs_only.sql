-- Migration 0042: TZS-only money model
--
-- The app previously stored money as integer USD cents and converted to TZS
-- for display at a fixed 2700 rate (cents * 27). That exchange-rate concept
-- has been removed: every money column now holds whole TZS directly.
--
-- payment_methods.fee_cents is a legacy column kept only for compatibility
-- with the order arithmetic CHECKs; it now mirrors fee_tzs exactly (both TZS).
-- Existing CASH rows may still hold the old USD-derived value, so align them.

UPDATE payment_methods
   SET fee_cents = fee_tzs
 WHERE fee_cents <> fee_tzs;