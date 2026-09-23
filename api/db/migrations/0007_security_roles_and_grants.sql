-- ============================================================================
-- Migration 0007: Least-privilege database roles and grants
-- ============================================================================
-- This migration creates PERMISSION-HOLDING roles (NOLOGIN — they cannot be
-- connected to directly) and grants them exactly the privileges the
-- application needs, table by table, statement by statement — deliberately
-- NOT "GRANT ALL", so the privilege list itself documents what each part of
-- the system is allowed to do.
--
-- It does NOT create LOGIN roles (actual database users with passwords).
-- Provisioning those, and rotating their credentials, is a secrets-managed
-- operational step outside version control — see docs/DATABASE.md
-- "Database access control" for the exact runbook. Once a LOGIN role
-- exists (e.g. `voguevibe_app_user`), grant it membership with:
--   GRANT voguevibe_app_role TO voguevibe_app_user;
-- and it inherits everything below — no re-granting needed on credential
-- rotation, since the privileges live on the group role, not the login.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voguevibe_app_role') THEN
    CREATE ROLE voguevibe_app_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voguevibe_readonly_role') THEN
    CREATE ROLE voguevibe_readonly_role NOLOGIN;
  END IF;
END
$$;

-- Harden the default: nobody gets anything just by connecting.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO voguevibe_app_role, voguevibe_readonly_role;

-- ---- voguevibe_app_role: the application's runtime privileges ----
-- Deliberately table-by-table and column-of-operation-by-operation, not a
-- blanket grant. Where a table's row below omits UPDATE or DELETE, that is
-- not an oversight — see the inline reasoning.

GRANT SELECT, INSERT, UPDATE                 ON users               TO voguevibe_app_role; -- never DELETE (see orders.user_id RESTRICT + docs/DATABASE.md lifecycle policy)
GRANT SELECT, INSERT, UPDATE, DELETE         ON addresses           TO voguevibe_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE         ON sessions            TO voguevibe_app_role; -- DELETE needed for the expired-session cleanup job
GRANT SELECT                                  ON permissions         TO voguevibe_app_role; -- reference data, managed by migrations only
GRANT SELECT                                  ON role_permissions    TO voguevibe_app_role; -- reference data, managed by migrations only

GRANT SELECT, INSERT, UPDATE                 ON brands              TO voguevibe_app_role; -- no DELETE: see products.brand_id RESTRICT
GRANT SELECT, INSERT, UPDATE                 ON categories          TO voguevibe_app_role; -- no DELETE: see products.category_id RESTRICT
GRANT SELECT, INSERT, UPDATE                 ON products            TO voguevibe_app_role; -- no DELETE: deletion is the `active = false` soft-delete (an UPDATE), see catalog.service.ts
GRANT SELECT, INSERT, UPDATE, DELETE         ON product_variants    TO voguevibe_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE         ON product_images      TO voguevibe_app_role;

GRANT SELECT, INSERT, UPDATE, DELETE         ON cart_items          TO voguevibe_app_role;
GRANT SELECT, INSERT, DELETE                 ON wishlist_items      TO voguevibe_app_role; -- no UPDATE: a wishlist row is only ever created or removed, never edited in place

GRANT SELECT, INSERT, UPDATE                 ON orders              TO voguevibe_app_role; -- no DELETE: orders are cancelled via status, never removed
GRANT SELECT, INSERT                          ON order_items         TO voguevibe_app_role; -- INTENTIONALLY no UPDATE, no DELETE: once written, a line item is immutable — enforced here, not just by convention in order.service.ts
GRANT SELECT, INSERT, UPDATE, DELETE         ON idempotency_keys    TO voguevibe_app_role; -- UPDATE: IN_PROGRESS -> COMPLETED; DELETE: TTL cleanup job

GRANT SELECT, INSERT                          ON activity_logs       TO voguevibe_app_role; -- INTENTIONALLY no UPDATE, no DELETE: append-only audit trail, enforced at the database level, not just by src/lib/audit.ts's exported function signatures

-- ---- voguevibe_readonly_role: reporting / analytics access ----
GRANT SELECT ON ALL TABLES IN SCHEMA public TO voguevibe_readonly_role;

-- Any table created by future migrations automatically gets the same
-- baseline (SELECT for readonly; migrations still must add explicit
-- app-role grants for new tables, deliberately — new tables should not
-- silently inherit full app-role CRUD without a conscious decision, same
-- as every table above).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO voguevibe_readonly_role;

COMMENT ON ROLE voguevibe_app_role IS 'Group role holding the VogueVibe application''s runtime privileges. LOGIN users are granted membership in this role; the role itself never logs in directly.';
COMMENT ON ROLE voguevibe_readonly_role IS 'Group role for reporting/analytics/BI tool access — SELECT only, on every table, no exceptions and no write path.';
