-- ============================================================================
-- Migration 0028: hash-based email-verification and password-reset tokens.
--
-- Both tables previously used their own row id (an unguessable UUID) AS
-- the bearer secret sent in the email link — the same pattern used for
-- sessions.id. That's fine for a SESSION row, because verifying a
-- refresh token also requires an HMAC signature checked against
-- REFRESH_TOKEN_SECRET (an env var, never stored in the database) — a
-- database read alone does not yield a usable refresh token.
--
-- These two tables had no such second factor: the row's own id WAS the
-- complete, sufficient secret. A database read (a leaked backup, a SQLi
-- read, an insider) handed out directly usable password-reset and
-- email-verification tokens — functionally equivalent to storing them in
-- plaintext, which the project's own stated requirements for both flows
-- explicitly rule out.
--
-- Fix: `id` stays a normal, non-secret primary key for indexing/joins.
-- A NEW random secret (32 bytes, hex-encoded) is generated at issue time,
-- sent in the email link, and never stored — only its SHA-256 hash is
-- persisted in the new `token_hash` column. A database read now yields
-- only hashes, from which the original token cannot be recovered.
--
-- `token_hash` is nullable (not NOT NULL) specifically so this migration
-- doesn't fail against any row that was inserted before it ships — any
-- already-outstanding token from before this migration simply has a NULL
-- hash and will never match a real request's computed hash, so it stops
-- working (equivalent to "please request a new one"). Given both
-- tables' short TTL (1-24 hours) this is a fully acceptable transition,
-- not a breaking one — nobody's account access is lost, only an
-- in-flight, unused link.
-- ============================================================================

ALTER TABLE email_verification_tokens
  ADD COLUMN IF NOT EXISTS token_hash TEXT;

ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS token_hash TEXT;

CREATE INDEX IF NOT EXISTS email_verification_tokens_hash_idx ON email_verification_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_hash_idx ON password_reset_tokens (token_hash);

COMMENT ON COLUMN email_verification_tokens.token_hash IS 'SHA-256 hex of the real bearer token sent in the email link. The plaintext token is never stored anywhere — only this hash. NULL for any row inserted before this migration (see this migration''s header for why that is safe).';
COMMENT ON COLUMN password_reset_tokens.token_hash IS 'SHA-256 hex of the real bearer token sent in the email link. The plaintext token is never stored anywhere — only this hash. NULL for any row inserted before this migration (see this migration''s header for why that is safe).';
