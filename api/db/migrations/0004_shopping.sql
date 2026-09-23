-- ============================================================================
-- Migration 0004: Cart and wishlist
-- ============================================================================

CREATE TABLE IF NOT EXISTS cart_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_id  UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 20),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per (user, variant) — "add to cart" for an existing line is an
  -- UPSERT (INSERT ... ON CONFLICT DO UPDATE), not a second row. This is
  -- also what makes that upsert atomic under concurrent "add to cart"
  -- double-clicks, without needing application-level locking.
  CONSTRAINT cart_items_unique_user_variant UNIQUE (user_id, variant_id)
);

CREATE INDEX IF NOT EXISTS cart_items_user_id_idx ON cart_items (user_id);

DROP TRIGGER IF EXISTS cart_items_set_updated_at ON cart_items;
CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE cart_items IS 'ON DELETE CASCADE from both users and product_variants: a cart line has no meaning without either. This is safe (unlike orders) because a cart is not a historical record — losing cart lines when a variant is discontinued is correct behavior, not data loss.';

CREATE TABLE IF NOT EXISTS wishlist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wishlist_items_unique_user_product UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS wishlist_items_user_id_idx ON wishlist_items (user_id);
