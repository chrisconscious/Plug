-- ============================================================================
-- Migration 0064: Super Admin can delete customer accounts
-- ============================================================================
--
-- A Super Admin can now delete a CUSTOMER account (users.service.ts
-- deleteCustomerAccount):
--   * no order / coupon / activity history -> the row is DELETEd; addresses,
--     cart, wishlist, sessions and notifications go with it (existing
--     ON DELETE CASCADE foreign keys).
--   * has history -> orders.user_id (and coupon_redemptions / activity_logs)
--     are ON DELETE RESTRICT, so order history can never be deleted with the
--     account. Instead the account is closed and its personal data erased:
--     name, email, phone, password, addresses, cart and wishlist are
--     removed, it can no longer sign in, and deleted_at is set. Orders keep
--     their own delivery-address / item snapshots, so sales records stay
--     complete.
-- Additive column + grant only; no data is changed. Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
COMMENT ON COLUMN users.deleted_at IS 'Set when a Super Admin deleted this account but its order history had to be kept (personal data erased, sign-in disabled). Migration 0063.';

DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['plug_app_role', 'voguevibe_app_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT DELETE ON users TO %I', r);
    END IF;
  END LOOP;
END
$$;
