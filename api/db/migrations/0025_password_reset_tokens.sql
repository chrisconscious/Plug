-- ============================================================================
-- Migration 0025: Password reset tokens.
--
-- Same pattern as email_verification_tokens (migration 0021): the row's
-- own id IS the bearer token sent in the email link — an unguessable
-- gen_random_uuid(), never a separately-hashed secret, because the row
-- itself already can't be found without knowing its id. consumed_at is
-- set on first use so a link can never be replayed. Short expiry (1 hour,
-- enforced in application code) reflects that this is a higher-stakes
-- action than email verification — it directly changes account access.
-- ============================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx ON password_reset_tokens (expires_at);

COMMENT ON TABLE password_reset_tokens IS 'One row per issued password-reset link. The row id itself is the token value (unguessable UUID) sent as ?token=<id> in the email link. consumed_at is set on first successful use; expired/consumed rows are inert and can be periodically deleted, same lifecycle as email_verification_tokens (see docs/DATABASE.md "Data lifecycle").';
