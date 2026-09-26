-- ============================================================================
-- Migration 0057: never show the seeded placeholder payment number
-- ============================================================================
--
-- 0014 seeded an active "M-Pesa (Lipa Namba)" method with the example number
-- '+255 700 000 000' so the Super Admin had something to edit. If that was
-- never replaced, checkout shows customers a number that isn't the store's
-- and asks them to send money to it. Switch such a method OFF (not deleted —
-- orders may reference it); it comes back once a Super Admin enters the real
-- Lipa Namba in Payment Methods and re-activates it. A method whose number
-- has already been changed is left exactly as it is.

UPDATE payment_methods
   SET is_active = false, updated_at = now()
 WHERE kind = 'ONLINE'
   AND regexp_replace(coalesce(payment_number, ''), '[^0-9]', '', 'g') = '255700000000';
