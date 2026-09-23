-- ============================================================================
-- Migration 0037: Phone number login
-- ============================================================================
-- Makes phone number a first-class login credential, alongside email
-- rather than replacing it outright. Existing accounts have no phone
-- number and must keep working unchanged; making phone number the ONLY
-- credential would lock every current account out. Going forward, new
-- registration/login flows use phone number as the primary field the
-- customer sees and enters — email becomes optional metadata rather than
-- disappearing from the schema (removing it outright would break email
-- verification, password reset, and every audit/notification path that
-- already depends on it).
--
-- Format: stored exactly as the customer enters it after basic
-- normalization at the application layer (see auth.service.ts) — this
-- migration only enforces non-blank and uniqueness, not a specific
-- country-code format, since that's presentation/validation logic, not
-- a database constraint concern.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_phone_number_not_blank;
ALTER TABLE users
  ADD CONSTRAINT users_phone_number_not_blank
    CHECK (phone_number IS NULL OR length(btrim(phone_number)) > 0);

-- Case difference doesn't apply to phone numbers (they're digits), so a
-- plain unique index is correct here — unlike email's CITEXT approach.
-- Partial (WHERE phone_number IS NOT NULL) so multiple existing accounts
-- with no phone number don't collide with each other under a uniqueness
-- check that would otherwise treat NULL = NULL.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_unique_idx
  ON users (phone_number) WHERE phone_number IS NOT NULL;

-- Email is no longer required going forward — a phone-registered account
-- may have no email at all. Existing accounts are unaffected (email stays
-- NOT NULL for rows that already have one; this only changes what's
-- required for NEW rows via the application layer, not existing data).
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

COMMENT ON COLUMN users.phone_number IS 'Primary login identifier for phone-registered accounts (migration 0037). Nullable for pre-existing email-only accounts. Unique when set.';
