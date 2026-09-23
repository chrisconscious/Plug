-- ============================================================================
-- Migration 0014: Payment methods (Online networks + Cash) and order payment
-- ============================================================================
-- Adds a single `payment_methods` table that models BOTH payment paths:
--   * Online mobile-money networks (e.g. M-Pesa, Tigo Pesa) — one row each,
--     with a `payment_number` the customer is told to send money to.
--   * A single CASH row carrying the flat transport/delivery fee.
-- Both are Super-Admin-managed (permission `payment_methods.manage`) and are
-- surfaced to Checkout via a public endpoint that returns only live rows.
--
-- Money is stored as integer cents (same convention as products/orders).
-- The orders table gains a snapshot of the payment method chosen at checkout
-- so a later rename / fee change / deactivation can never alter a past order
-- (mirrors how product name/price are already snapshotted onto order_items).

CREATE TABLE IF NOT EXISTS payment_methods (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'CASH' = pay on delivery/pickup (carries the flat transport fee);
  -- 'ONLINE' = a mobile-money network the customer sends money to.
  kind             TEXT NOT NULL CHECK (kind IN ('CASH', 'ONLINE')),
  -- Human-facing label, e.g. "Cash on Delivery", "M-Pesa (Lipa Namba)".
  name             TEXT NOT NULL,
  -- Only for ONLINE rows: the exact account/number the customer pays into.
  payment_number   TEXT,
  -- Only meaningful for the CASH row: flat transport/delivery fee in cents.
  fee_cents        INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT payment_methods_name_not_blank CHECK (length(btrim(name)) > 0),
  -- An ONLINE method must always carry a payment number to pay into.
  CONSTRAINT payment_methods_online_requires_number
    CHECK (kind <> 'ONLINE' OR length(btrim(payment_number)) > 0),
  -- A CASH row is the transport-fee bearer; fee must be >= 0 (checked above).
  CONSTRAINT payment_methods_cash_number_null CHECK (kind <> 'CASH' OR payment_number IS NULL)
);

CREATE TRIGGER payment_methods_set_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Checkout's public query: active methods, in display order.
CREATE INDEX IF NOT EXISTS payment_methods_active_order_idx
  ON payment_methods (display_order)
  WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_methods TO voguevibe_app_role;

COMMENT ON TABLE payment_methods IS 'Payment paths offered at checkout. ONLINE rows are mobile-money networks with a payment_number the customer pays into; a single CASH row carries the flat transport fee (fee_cents). All rows are Super-Admin managed via payment_methods.manage.';

-- ---------------------------------------------------------------------------
-- Seed the two well-known rows so Checkout works out of the box, and so the
-- Super Admin has something concrete to edit/deactivate from the very start.
-- Idempotent: rely on the UNIQUE partial index instead of a hardcoded id so a
-- re-run never duplicates them.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_one_cash_idx
  ON payment_methods ((kind)) WHERE kind = 'CASH';

INSERT INTO payment_methods (kind, name, display_order, is_active, fee_cents)
SELECT 'CASH', 'Cash on Delivery', 0, true, 3000
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE kind = 'CASH');

INSERT INTO payment_methods (kind, name, payment_number, display_order, is_active)
SELECT 'ONLINE', 'M-Pesa (Lipa Namba)', '+255 700 000 000', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods WHERE kind = 'ONLINE' AND name = 'M-Pesa (Lipa Namba)'
);

-- ---------------------------------------------------------------------------
-- Orders: record how the order was paid + the transport fee actually applied.
-- `payment_method_kind` identifies Cash vs an online network; the label/number
-- are snapshots (like order_items) so later edits never rewrite history. The
-- transport fee is folded into `shipping_cents` at order time to satisfy the
-- existing `orders_total_matches_arithmetic` CHECK; `transport_fee_cents`
-- keeps the disaggregated figure for audit/finance.
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method_kind    TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_name    TEXT,
  ADD COLUMN IF NOT EXISTS payment_number         TEXT,
  ADD COLUMN IF NOT EXISTS transport_fee_cents    INTEGER NOT NULL DEFAULT 0
    CHECK (transport_fee_cents >= 0);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_method_kind_allowed;
ALTER TABLE orders
  ADD CONSTRAINT orders_payment_method_kind_allowed
  CHECK (payment_method_kind IS NULL OR payment_method_kind IN ('CASH', 'ONLINE'));

-- ---------------------------------------------------------------------------
-- RBAC reference data: dedicated payment-methods permission (Super Admin only).
-- Keep in sync with src/lib/rbac.ts (PERMISSIONS + ROLE_PERMISSIONS).
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
  ('payment_methods.manage', 'Create, edit, reorder, deactivate, and configure payment methods and the cash transport fee.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code)
SELECT r.role, 'payment_methods.manage'
FROM (VALUES ('SUPER_ADMIN')) AS r(role)
ON CONFLICT (role, permission_code) DO NOTHING;
