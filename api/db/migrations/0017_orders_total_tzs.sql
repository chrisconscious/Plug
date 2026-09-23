-- ============================================================================
-- Migration 0017: Exact TZS order total snapshot
-- ============================================================================
-- The storefront shows prices in TZS, but money is stored as integer USD
-- cents at the fixed 2700 rate. A TZS transport fee (e.g. 600) or any sum
-- whose TZS/27 is not an integer can make the displayed line items not add
-- up when each is converted independently (e.g. subtotal 410,400 + fee 600
-- showed a 410,994 total). The order therefore snapshots the EXACT TZS
-- total the customer is charged — computed as the sum of the displayed
-- parts — while the cents columns keep satisfying the 0005 arithmetic CHECK.
--
-- Backfill is exact: cents * 2700 / 100 == cents * 27.
-- ----------------------------------------------------------------------------

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS total_tzs BIGINT NOT NULL DEFAULT 0
    CHECK (total_tzs >= 0);

UPDATE orders
   SET total_tzs = total_cents * 27
 WHERE total_tzs = 0 AND total_cents > 0;

COMMENT ON COLUMN orders.total_tzs IS 'Exact TZS total the customer was charged at checkout (subtotal + delivery + transport, each rounded to whole shillings). total_cents is the internal USD-cent equivalent used by the arithmetic CHECK.';
COMMENT ON COLUMN orders.transport_fee_tzs IS 'Exact transport fee in TZS snapshotted for this order (Cash orders).';