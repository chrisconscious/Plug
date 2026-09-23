-- ============================================================================
-- Migration 0027: idempotency key payload fingerprinting.
--
-- The idempotency_keys table (migration 0005) correctly prevents a
-- replayed/duplicate request from creating a second order — but it only
-- ever compared the KEY, never the actual request payload. That means a
-- client (or a bug, or a client-side idempotency-key generation mistake)
-- reusing the same key with a genuinely DIFFERENT shipping address or
-- payment method would silently get back the ORIGINAL order instead of
-- an error — the two requests were never compared to each other at all.
--
-- request_fingerprint is a hash of the meaningful request fields (shipping
-- address, payment method, transport payment number) computed by the
-- application at claim time (see order.service.ts). On a key collision,
-- the fingerprint is compared: matching -> genuine replay, return the
-- cached result; not matching -> reject with a distinct error rather than
-- silently substituting a different request's result.
-- ============================================================================

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

COMMENT ON COLUMN idempotency_keys.request_fingerprint IS 'SHA-256 hex of the request''s meaningful fields (see order.service.ts). NULL only for rows written before this migration; the application always populates it for every new claim going forward.';
