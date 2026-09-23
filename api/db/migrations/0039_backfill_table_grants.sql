-- ============================================================================
-- Migration 0039: Backfill app-role privileges for tables whose creating
-- migrations (0021 email verification, 0022 MFA recovery, 0023 media
-- registry, 0025 password reset, 0026 homepage promo banner) omitted the
-- same GRANT ... TO plug_app_role statement every other table-creating
-- migration in this project includes. Those tables have always been queried
-- by the application runtime, and this omission was surfaced as "permission
-- denied for table media / homepage_promo_banner" 500s on the storefront —
-- the gap simply was never exercised until now because the affected flows
-- (email verification, password reset, MFA recovery codes, media upload,
-- promo banner) were not reachable before. Privilege sets mirror the
-- conventions each table's owning migration would have used:
-- token tables and `media` get full runtime CRUD; the singleton promo
-- banner follows the SELECT, INSERT, UPDATE pattern of platform_settings
-- (0029) and homepage_brand_settings (0020).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON email_verification_tokens TO plug_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes         TO plug_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON media                     TO plug_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens     TO plug_app_role;
GRANT SELECT, INSERT, UPDATE ON homepage_promo_banner              TO plug_app_role;