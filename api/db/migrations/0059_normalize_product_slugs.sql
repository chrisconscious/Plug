-- ============================================================================
-- Migration 0059: Normalize malformed product slugs
-- ============================================================================
--
-- New and edited products have always had their slug normalized by the app
-- (catalog.service.ts slugifyProduct: lowercase ASCII letters/digits joined by
-- single dashes). Products saved by older code could still carry raw slugs
-- such as "/Classic Tshirt": the leading "/" and the space have to be
-- percent-encoded in /product/<slug> links (%2F, %20), and an encoded "/" is
-- something proxies and servers may decode or reject, so those product pages
-- can fail to open.
--
-- This rewrites ONLY slugs that are not already in the canonical form, using
-- the same rules as slugifyProduct. Nothing else on the row changes (the
-- slug is a URL key only: carts, orders, wishlists and images reference the
-- product id). If the normalized slug is already taken by another product,
-- the first 8 characters of this product's id are appended so the unique
-- index is never violated. Old links keep working: the product endpoint also
-- resolves a requested slug through the same normalization
-- (catalog.service.ts getProductBySlug), so "/product/%2FClassic%20Tshirt"
-- still opens the product, now stored as "classic-tshirt".
--
-- Idempotent: once every slug is canonical, re-running changes nothing.

DO $$
DECLARE
  r          RECORD;
  candidate  TEXT;
BEGIN
  FOR r IN
    SELECT id, slug, name
      FROM products
     WHERE slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     ORDER BY created_at, id
  LOOP
    candidate := regexp_replace(lower(btrim(r.slug)), '[^a-z0-9]+', '-', 'g');
    candidate := regexp_replace(candidate, '^-+|-+$', '', 'g');
    IF candidate = '' THEN
      -- Nothing usable left in the slug (e.g. only punctuation): derive it from the name.
      candidate := regexp_replace(lower(btrim(r.name)), '[^a-z0-9]+', '-', 'g');
      candidate := regexp_replace(candidate, '^-+|-+$', '', 'g');
    END IF;
    IF candidate = '' THEN
      candidate := 'product';
    END IF;
    candidate := regexp_replace(left(candidate, 120), '-+$', '');

    IF EXISTS (SELECT 1 FROM products WHERE slug = candidate AND id <> r.id) THEN
      candidate := candidate || '-' || left(r.id::text, 8);
    END IF;

    UPDATE products SET slug = candidate WHERE id = r.id;
    RAISE NOTICE 'product % slug "%" -> "%"', r.id, r.slug, candidate;
  END LOOP;
END $$;
