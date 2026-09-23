-- ============================================================================
-- Development seed data — NOT run by the migration runner automatically.
-- Run explicitly: npm run db:seed
-- Idempotent (ON CONFLICT DO NOTHING keyed on slug/unique combo), safe to
-- run repeatedly against the same database.
--
-- Deliberately contains NO user accounts / passwords — see
-- db/scripts/create-super-admin.ts for provisioning the first Super Admin,
-- which is an interactive script (not a checked-in credential) per
-- docs/SECURITY.md item 9.
-- ============================================================================

INSERT INTO brands (slug, name) VALUES
  ('nike', 'Nike'),
  ('gucci', 'Gucci'),
  ('zara', 'Zara'),
  ('calvin-klein', 'Calvin Klein')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name) VALUES
  ('clothing', 'Clothing'),
  ('shoes', 'Shoes'),
  ('bags', 'Bags')
ON CONFLICT (slug) DO NOTHING;

WITH new_products AS (
  INSERT INTO products (slug, name, brand_id, category_id, price_cents, active)
  SELECT v.slug, v.name, b.id, c.id, v.price_cents, true
  FROM (VALUES
    ('oversized-linen-blazer', 'Oversized Linen Blazer', 'zara', 'clothing', 12900),
    ('minimal-leather-bag',    'Minimal Leather Bag',    'gucci', 'bags',    15900),
    ('classic-white-sneakers', 'Classic White Sneakers', 'nike', 'shoes',   9900)
  ) AS v(slug, name, brand_slug, category_slug, price_cents)
  JOIN brands b ON b.slug = v.brand_slug
  JOIN categories c ON c.slug = v.category_slug
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug
)
INSERT INTO product_variants (product_id, size, color, stock_qty)
SELECT p.id, sz.size, 'Default',
  -- Same "deliberately low stock on M" pattern as the Phase 1 in-memory
  -- seed, so the concurrency test script in docs/DATABASE.md still has a
  -- realistic low-stock variant to exercise.
  CASE WHEN sz.size = 'M' THEN 3 ELSE 25 END
FROM new_products p
CROSS JOIN (VALUES ('S'), ('M'), ('L')) AS sz(size)
ON CONFLICT (product_id, size, color) DO NOTHING;
