-- ============================================================================
-- Migration 0060: Grants the application role was missing
-- ============================================================================
--
-- Production connects with a least-privilege login that is a member of the
-- application role (plug_app_role; databases created before migration 0030
-- may still carry the original voguevibe_app_role for the oldest tables).
-- Comparing every INSERT/UPDATE/DELETE/SELECT the code runs against those
-- roles' grants found these gaps, each of which is a 500 in production
-- ("permission denied for table ..."):
--
--   coupon_redemptions DELETE  order cancellation frees the coupon redemption
--                              (orders.repo.ts updateOrderStatusTransactional)
--   coupons            DELETE  admin deletes a coupon (coupons.service.ts)
--   brands             DELETE  admin deletes an unused brand (catalog.service.ts)
--   categories         DELETE  admin deletes an unused category (catalog.service.ts)
--   product_search     SELECT/INSERT/UPDATE
--                              search reads it; the 0058 triggers write it as
--                              the user changing a product (0058 created the
--                              table without granting it to the app role)
--
-- Deleting a brand or category that products still use remains impossible:
-- products.brand_id / category_id are ON DELETE RESTRICT, and the service
-- refuses first with a clear message. Grants only — no data is changed.
-- Idempotent (GRANT of an existing privilege is a no-op).

DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['plug_app_role', 'voguevibe_app_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT DELETE ON coupon_redemptions TO %I', r);
      EXECUTE format('GRANT DELETE ON coupons TO %I', r);
      EXECUTE format('GRANT DELETE ON brands TO %I', r);
      EXECUTE format('GRANT DELETE ON categories TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON product_search TO %I', r);
    END IF;
  END LOOP;
END
$$;
