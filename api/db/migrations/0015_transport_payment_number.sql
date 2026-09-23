-- ============================================================================
-- Migration 0015: Transport-fee payment network snapshot for Cash orders
-- ============================================================================
-- A Cash on Delivery order can require the customer to first pay the flat
-- transport fee through a chosen mobile-money network (the "transport
-- channel"). This record keeps a snapshot of WHICH network handled that fee,
-- mirroring how the payment method itself is already snapshotted.
--
--   * transport_payment_number -> the payment number of the network the
--     customer sent the transport fee to (e.g. "+255 700 000 000").
--   * transport_payment_name   -> its human label (e.g. "M-Pesa (Lipa Namba)")
--     for display in admin/order history.
--
-- Only populated for CASH orders where a transport channel was required;
-- ONLINE orders and CASH orders without a required channel leave these NULL.
-- ----------------------------------------------------------------------------

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transport_payment_number TEXT,
  ADD COLUMN IF NOT EXISTS transport_payment_name   TEXT;

COMMENT ON COLUMN orders.transport_payment_number IS 'Snapshot of the mobile-money number the customer paid the transport fee to (Cash orders only).';
COMMENT ON COLUMN orders.transport_payment_name IS 'Snapshot of the transport channel label (Cash orders only).';
