-- ============================================================================
-- Migration 0062: Grace window for rotated refresh sessions
-- ============================================================================
--
-- Refresh tokens are single-use: renewing a session used to REVOKE the old
-- one immediately. When the old token is presented again a moment later the
-- customer was signed out, which happens in normal use:
--   * two tabs (or the installed app and a browser tab) renew at once —
--     the loser's refresh fails and clears the cookies the winner just set;
--   * the phone's connection drops after the server rotated but before the
--     new cookie arrived — the browser still holds the revoked token.
-- rotated_at records when a session was renewed. A rotated token is still
-- accepted for a short grace window (auth.service.ts
-- REFRESH_ROTATION_GRACE_SECONDS) and refused after it, so it stays
-- effectively single-use. Explicit sign-out / password change still sets
-- revoked = true, which is refused immediately.
-- Additive, nullable column; no data is changed. Idempotent.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
