-- ============================================================================
-- Migration 0030: Rename database roles from VogueVibe to PLUG identity
-- ============================================================================
-- The platform's customer-facing identity is now "PLUG" (see migration
-- 0029's platform_settings, defaulting platform_name to 'PLUG'). This
-- migration completes that by renaming the two GROUP roles created in
-- migration 0007, which still carried the old "voguevibe_*" names.
--
-- This is SAFE and does not require touching any GRANT statement in
-- migrations 0007 through 0029: PostgreSQL tracks roles internally by
-- OID, not by name. `ALTER ROLE ... RENAME TO ...` updates the name in
-- place — every privilege already granted TO the old name automatically
-- continues to apply to the renamed role. Nothing needs to be re-granted.
--
-- Idempotent: only renames if the old name still exists and the new name
-- doesn't already exist (so re-running this migration, or running it
-- after someone already renamed the roles manually, is a safe no-op).
--
-- What this migration does NOT do, and why (documented, not guessed at):
--   1. Rename the actual LOGIN role (e.g. `voguevibe_app_user`) that
--      holds membership in `voguevibe_app_role`. Per migration 0007's own
--      comment, LOGIN roles are provisioned outside version control as a
--      secrets-managed operational step — this migration has no way to
--      know what that role is actually named in any given deployment, or
--      whether renaming it would break an already-configured
--      DATABASE_URL. If you want full consistency, rename your LOGIN
--      role to match (e.g. `plug_app_user`) as a separate, deliberate
--      operational step, then update DATABASE_URL accordingly — see
--      docs/DATABASE.md.
--   2. Rename the database itself (e.g. `voguevibe` -> `plug`). A
--      migration runs as an active connection INSIDE the database it
--      would need to rename, which PostgreSQL does not allow (you cannot
--      rename a database you're currently connected to) — this is not a
--      migration-shaped operation. Renaming a live database also
--      requires disconnecting every other session first, which is a
--      real-downtime operational decision for whoever operates the
--      actual infrastructure, not something to force silently here.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voguevibe_app_role')
     AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plug_app_role') THEN
    ALTER ROLE voguevibe_app_role RENAME TO plug_app_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voguevibe_readonly_role')
     AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plug_readonly_role') THEN
    ALTER ROLE voguevibe_readonly_role RENAME TO plug_readonly_role;
  END IF;
END
$$;

-- Refresh the role comments to reflect the current name and identity
-- (COMMENT ON ROLE always targets by current name, so this must run
-- after the rename above, using the new names).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plug_app_role') THEN
    COMMENT ON ROLE plug_app_role IS 'Group role holding the PLUG application''s runtime privileges (renamed from voguevibe_app_role in migration 0030 — see that migration for why the rename is safe). LOGIN users are granted membership in this role; the role itself never logs in directly.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plug_readonly_role') THEN
    COMMENT ON ROLE plug_readonly_role IS 'Group role for reporting/analytics/BI tool access — SELECT only, on every table, no exceptions and no write path. Renamed from voguevibe_readonly_role in migration 0030.';
  END IF;
END
$$;
