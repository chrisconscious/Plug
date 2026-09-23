-- ============================================================================
-- Migration 0016: Store the Cash transport fee natively in TZS
-- ============================================================================
-- The store's money model is integer USD cents at a fixed USD->TZS display
-- rate (2700). A round TZS transport fee (e.g. 5,000) cannot be represented
-- exactly in whole cents (5,000 / 2,700 * 100 = 185.19), so converting
-- TZS -> cents -> TZS lost a few shillings (5,000 became 4,995). That was
-- wrong for a fee the merchant sets in shillings and the customer is shown.
--
-- This migration gives the CASH transport fee a native TZS home:
--   * payment_methods.fee_tzs        -> exact TZS fee the admin set
--   * orders.transport_fee_tzs       -> exact TZS fee snapshotted per order
-- fee_cents / transport_fee_cents remain, derived (rounded) purely so the
-- existing total-arithmetic CHECKs (0005/0014) keep working in USD cents.
--
-- Backfill is exact: cents * 2700 / 100 == cents * 27 (integer).
-- ----------------------------------------------------------------------------

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS fee_tzs BIGINT NOT NULL DEFAULT 0
    CHECK (fee_tzs >= 0);

UPDATE payment_methods
   SET fee_tzs = fee_cents * 27
 WHERE kind = 'CASH' AND fee_tzs = 0 AND fee_cents > 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transport_fee_tzs BIGINT NOT NULL DEFAULT 0
    CHECK (transport_fee_tzs >= 0);

UPDATE orders
   SET transport_fee_tzs = transport_fee_cents * 27
 WHERE transport_fee_tzs = 0 AND transport_fee_cents > 0;

COMMENT ON COLUMN payment_methods.fee_tzs IS 'Exact Cash transport fee in TZS as set by the admin. fee_cents is the rounded USD-cent equivalent used by order arithmetic.';
COMMENT ON COLUMN orders.transport_fee_tzs IS 'Exact transport fee in TZS snapshotted for this order (Cash orders).';