-- ============================================================================
-- Migration 0021: Email verification.
--
-- New accounts are usable immediately (see docs/SECURITY.md "remaining
-- risks" #5 — this was a known, documented gap). This migration adds the
-- data needed to close it: a verified flag on users, and a table of
-- short-lived, single-use verification tokens (the token's own id IS the
-- bearer secret sent in the email link — same pattern as `sessions.id`
-- in migration 0002, an unguessable gen_random_uuid()).
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.email_verified IS 'True once the user has clicked a valid link from an email_verification_tokens row. Enforcement (e.g. blocking checkout) lives in application code — see order.service.ts createOrderFromCart.';

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resend + verify both look up "this user's live tokens".
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx ON email_verification_tokens (user_id);
-- Supports a periodic cleanup job, same pattern as sessions_expires_at_idx.
CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_at_idx ON email_verification_tokens (expires_at);

COMMENT ON TABLE email_verification_tokens IS 'One row per issued verification link. The row id itself is the token value (unguessable UUID) sent as ?token=<id> in the email link. consumed_at is set on first successful use so a link cannot be replayed; expired/consumed rows are inert and periodically deleted, same lifecycle as sessions (see docs/DATABASE.md "Data lifecycle").';
