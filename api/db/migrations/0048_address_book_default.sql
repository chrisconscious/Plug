-- ============================================================================
-- Migration 0048: Address book default flag
-- ============================================================================
-- The addresses table (migration 0002) already exists with exactly the
-- shape checkout needs (label, line1/2, city, region, postal_code,
-- country, phone) — it was already the right table, just missing a
-- default-address concept and never given a full CRUD API. This migration
-- adds only what was missing rather than creating a second, disconnected
-- address system, per this feature's own explicit requirement.

ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- At most one default address per user — enforced at the database level,
-- not just by application code remembering to unset the previous default
-- before setting a new one. A partial unique index (only over rows where
-- is_default is true) is the standard way to express "unique among a
-- subset of rows" in Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_per_user
  ON addresses (user_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS addresses_user_id_idx ON addresses (user_id);

COMMENT ON COLUMN addresses.is_default IS 'The customer''s default address for checkout pre-fill and account display. At most one true row per user_id, enforced by addresses_one_default_per_user.';
