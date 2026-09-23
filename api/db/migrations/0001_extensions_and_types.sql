-- ============================================================================
-- Migration 0001: Extensions and shared enum types
-- ============================================================================
-- Idempotent-safe (IF NOT EXISTS / DO blocks) so this can be re-run against
-- an environment where it partially applied. Every migration in this
-- directory follows the same pattern and is tracked in `schema_migrations`
-- by db/scripts/migrate.ts (see docs/DATABASE.md "Migration strategy").

-- pgcrypto: gen_random_uuid() for primary keys. (UUIDv4, not UUIDv7 — see
-- docs/DATABASE.md "ID strategy" for why, and what would change that.)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- citext: case-insensitive text, used for email so uniqueness/lookups don't
-- depend on the application always normalizing case (defense in depth —
-- the app also lowercases emails itself; see lib/validate.ts#isEmail).
CREATE EXTENSION IF NOT EXISTS citext;

-- Enum types are used for small, closed, rarely-changing value sets where a
-- CHECK constraint on TEXT would otherwise be repeated everywhere. Roles are
-- deliberately NOT an enum (see 0002) because Postgres enums are painful to
-- extend later (ALTER TYPE ... ADD VALUE cannot run inside a transaction in
-- older PG versions) and the role set, while small, is exactly the kind of
-- thing product/business requirements add to over time (e.g. a future
-- "SUPPORT" role). Order status and user role therefore use TEXT + CHECK
-- instead, which is a trivial migration to extend (see 0005).

COMMENT ON EXTENSION pgcrypto IS 'Provides gen_random_uuid() for UUID primary keys.';
COMMENT ON EXTENSION citext IS 'Case-insensitive text type, used for email uniqueness.';
