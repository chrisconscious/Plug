-- ============================================================================
-- Migration 0005: Orders, order items, and idempotency keys
-- ============================================================================
-- This is the most integrity-critical schema in the platform. Every
-- constraint here exists to make an incorrect state IMPOSSIBLE to write,
-- not just unlikely — see docs/DATABASE.md "Data integrity" for the full
-- rationale and the corruption-attempt tests that verify each one.

CREATE TABLE IF NOT EXISTS orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, not CASCADE: a user with order history can never be
  -- hard-deleted — see docs/DATABASE.md "Data lifecycle" for the required
  -- anonymization workflow (retain the order/financial trail, scrub PII on
  -- the user row) instead of a destructive delete.
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status       TEXT NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED')),

  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  total_cents    INTEGER NOT NULL CHECK (total_cents >= 0),

  -- Snapshot, not a foreign key to `addresses` — the customer's saved
  -- address may change or be deleted after the order ships; the order must
  -- keep showing exactly what was shipped to. JSONB is justified here
  -- specifically because this blob is written once, read as a whole, and
  -- never queried/filtered by its internal fields.
  shipping_address_snapshot JSONB NOT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- These two CHECK constraints make an internally-inconsistent order total
  -- IMPOSSIBLE to insert or update, regardless of what application code
  -- (correctly or buggily) computed — the database is the last line of
  -- defense, not just the application's arithmetic.
  CONSTRAINT orders_discount_not_exceeding_subtotal CHECK (discount_cents <= subtotal_cents),
  CONSTRAINT orders_total_matches_arithmetic
    CHECK (total_cents = subtotal_cents - discount_cents + shipping_cents)
);

-- The #1 customer-facing query: "my orders, most recent first."
CREATE INDEX IF NOT EXISTS orders_user_id_created_at_idx ON orders (user_id, created_at DESC);
-- The #1 admin-facing query: "all orders in status X" (e.g. fulfillment queue).
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE orders IS 'Orders are never hard-deleted by application code (only status-transitioned to CANCELLED) — see order.service.ts. The RESTRICT on user_id and the two arithmetic CHECK constraints exist specifically to make "delete a user with orders" and "an order whose total does not equal its line items" both impossible at the database level, not just discouraged in application code.';

-- ---------------------------------------------------------------------------
-- order_items — immutable historical snapshot of what was purchased
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- SET NULL, not RESTRICT/CASCADE: order_items must survive a product or
  -- variant being deleted from the catalog. Every field needed to display
  -- or audit this line item is already snapshotted below — these two
  -- columns are kept only as a "was this the same product as X" traceability
  -- link where still available, never as the source of truth for the line.
  product_id         UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id         UUID REFERENCES product_variants(id) ON DELETE SET NULL,

  name_snapshot      TEXT NOT NULL,
  brand_snapshot     TEXT NOT NULL,
  size               TEXT NOT NULL,
  color              TEXT NOT NULL,
  unit_price_cents_snapshot INTEGER NOT NULL CHECK (unit_price_cents_snapshot >= 0),
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents   INTEGER NOT NULL CHECK (line_total_cents >= 0),

  CONSTRAINT order_items_line_total_matches_arithmetic
    CHECK (line_total_cents = unit_price_cents_snapshot * quantity)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
-- Supports "which orders contain product X" (e.g. a recall/quality-issue lookup).
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON order_items (product_id) WHERE product_id IS NOT NULL;

COMMENT ON TABLE order_items IS 'Immutable purchase-time snapshot. A later product rename, price change, or deletion can never alter what a historical order shows — this is the database-level enforcement of the same guarantee order.service.ts implements in application code (defense in depth, not redundancy: the CHECK constraint here catches a bug even if the application logic that computed these values were wrong).';

-- ---------------------------------------------------------------------------
-- idempotency_keys — replaces the Phase 1 in-memory Map with a real,
-- multi-instance-safe mechanism: the (scope, user_id, key) PRIMARY KEY
-- itself IS the concurrency control. A second concurrent request with the
-- same key hits a duplicate-key violation (SQLSTATE 23505), which
-- application code catches and treats as "already handled" — see
-- src/lib/db/repos/orders.repo.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope            TEXT NOT NULL,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_body    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, user_id, idempotency_key)
);

-- Supports the periodic cleanup job (idempotency keys are only meaningful
-- for a bounded replay window — 24h in application config — not forever).
CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx ON idempotency_keys (created_at);

COMMENT ON TABLE idempotency_keys IS 'Multi-instance-safe replacement for the Phase 1 in-memory idempotency Map. The composite PRIMARY KEY provides the atomicity: INSERT ... ON CONFLICT DO NOTHING (or a plain INSERT caught for 23505) is how the application detects a replayed/duplicate request, which works correctly even with many backend instances behind a load balancer — unlike the process-local Map it replaces.';
