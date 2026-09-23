-- ============================================================================
-- Migration 0022: TOTP-based MFA for Admin / Super Admin accounts.
--
-- Scoped to ADMIN/SUPER_ADMIN only (see docs/SECURITY.md "remaining risks"
-- #7 — this was a known, documented gap). Customers are unaffected.
--
-- `totp_secret` is set (pending) as soon as setup begins, but MFA is not
-- enforced at login until `mfa_enabled` flips to true — that only happens
-- once the admin proves they can generate a valid code (see
-- auth.service.ts enableMfa()), so a half-finished setup can never lock
-- someone out of their own account.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.totp_secret IS 'Base32 TOTP shared secret (RFC 6238). Present once MFA setup has started; only enforced at login once mfa_enabled is true. Protected the same way password_hash is — by database access control, not additional application-level encryption (no key-management infra exists in this phase; see docs/SECURITY.md if that changes).';
COMMENT ON COLUMN users.mfa_enabled IS 'True once the admin has confirmed a valid code against totp_secret. Login requires a second factor only when this is true — see auth.service.ts loginWithPassword() / completeMfaLogin().';

-- One-time-use recovery codes (lost-phone fallback). A user can have several
-- unused ones at a time; each row is deleted the moment it's redeemed so a
-- code can never be replayed — no separate "consumed" flag needed.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL, -- SHA-256 of the code the admin was shown once; never store the raw code
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_id_idx ON mfa_recovery_codes (user_id);

COMMENT ON TABLE mfa_recovery_codes IS 'Single-use MFA backup codes. Only the SHA-256 hash is stored — the raw code is shown to the admin exactly once, at generation time, the same way a password is never stored in recoverable form.';
