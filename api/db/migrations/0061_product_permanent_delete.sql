-- ============================================================================
-- Migration 0061: Allow permanently deleting an ARCHIVED product
-- ============================================================================
--
-- "Delete" in the admin archives a product (the row stays). An archived
-- product still points at its brand and category, so that brand/category can
-- never be deleted (products.brand_id / category_id are ON DELETE RESTRICT).
-- A Super Admin can now permanently delete an archived product
-- (catalog.service.ts permanentlyDeleteProduct), which needs DELETE on
-- products. Every table referencing products already handles it:
--   order_items.product_id / variant_id  ON DELETE SET NULL (the line keeps
--                                        its name/brand/price snapshot)
--   variants, images, cart, wishlist,
--   lifestyles, attributes, search       ON DELETE CASCADE
-- Grant only — no data is changed. Idempotent.

DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['plug_app_role', 'voguevibe_app_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT DELETE ON products TO %I', r);
    END IF;
  END LOOP;
END
$$;
