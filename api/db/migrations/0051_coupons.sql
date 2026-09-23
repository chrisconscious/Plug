-- ============================================================================
-- Migration 0051: Coupons
-- ============================================================================
-- Implements the "Promotions, Coupons & Discounts" nav module for real —
-- it previously showed an honest "not wired up yet" placeholder rather
-- than fake data, and order creation already had a discount_cents column
-- (migration 0005) sitting unused with a hardcoded 0 and an explicit
-- "deferred" comment. This is that deferral being resolved.

CREATE TABLE IF NOT EXISTS coupons (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT NOT NULL UNIQUE CHECK (code = upper(code) AND length(code) BETWEEN 3 AND 32),
  discount_type        TEXT NOT NULL CHECK (discount_type IN ('FIXED', 'PERCENTAGE')),
  -- Same "cents" naming as every other money column in this schema
  -- (orders.subtotal_cents etc.) despite actually holding whole TZS —
  -- an established, if historically confusing, convention (see
  -- docs/ARCHITECTURE.md's money-model note); PERCENTAGE stores 1-100,
  -- FIXED stores a TZS amount, never both interpreted the same way.
  discount_value       INTEGER NOT NULL CHECK (discount_value > 0),
  min_order_cents      INTEGER NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  -- NULL = no cap on total redemptions across all customers.
  max_redemptions      INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  -- NULL = no per-customer cap; 1 is the common "first-order-only" case.
  max_redemptions_per_customer INTEGER CHECK (max_redemptions_per_customer IS NULL OR max_redemptions_per_customer > 0),
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  -- Optional scope: NULL scope_type = valid storewide. When set, the
  -- coupon only discounts line items matching that one category or
  -- brand (see the service layer's per-line scoping logic) rather than
  -- the whole order.
  scope_type           TEXT CHECK (scope_type IS NULL OR scope_type IN ('CATEGORY', 'BRAND')),
  scope_id             UUID,
  active               BOOLEAN NOT NULL DEFAULT true,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_percentage_range CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100),
  CONSTRAINT coupons_date_range CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CONSTRAINT coupons_scope_pair CHECK ((scope_type IS NULL) = (scope_id IS NULL))
);

CREATE INDEX IF NOT EXISTS coupons_active_dates_idx ON coupons (active, starts_at, ends_at);

-- One row per successful redemption — never deleted (it's the audit
-- trail this document explicitly asks for), and this table, not a
-- counter on the coupons row, is the source of truth for "how many
-- times has this been used," so counting is always race-safe under
-- concurrent checkouts (see the service layer's use of this table
-- inside the same transaction as order creation, with a row lock on
-- the coupon itself).
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id         UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  discount_applied_cents INTEGER NOT NULL CHECK (discount_applied_cents >= 0),
  redeemed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupon_redemptions_one_per_order UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx ON coupon_redemptions (user_id);

GRANT SELECT, INSERT, UPDATE ON coupons TO plug_app_role;
GRANT SELECT, INSERT ON coupon_redemptions TO plug_app_role;

COMMENT ON TABLE coupons IS 'Discount codes — fixed TZS amount or percentage, with optional date range, usage limits, minimum order, and category/brand scope.';
COMMENT ON TABLE coupon_redemptions IS 'Append-only audit trail of actual coupon usage, one row per order — the authoritative source for usage-limit counting, not a counter column on coupons (avoids race conditions under concurrent checkouts).';
