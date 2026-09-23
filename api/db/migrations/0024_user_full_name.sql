-- ============================================================================
-- Migration 0024: user full_name.
--
-- The registration UI has always shown a "Full name" field, but it was
-- discarded at every layer: the frontend never sent it, the backend never
-- accepted it, and no column existed to store it. This migration adds the
-- column; auth.service.ts/the register route are updated in the same
-- change to actually thread it through.
--
-- Single `full_name` column (not first_name/last_name): every other "name"
-- field in this schema (brands.name, products.name, categories.name,
-- lifestyles.name) is one string, and the UI already collects one "Full
-- name" input rather than separate fields — splitting it would be a new
-- convention introduced for no reason, not a fix.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name TEXT;

COMMENT ON COLUMN users.full_name IS 'Optional — the UI does not require it at registration. NULL for any account created before this migration, or where the user left it blank.';
