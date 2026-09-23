-- ============================================================================
-- Migration 0002: Users, addresses, sessions, and the permission reference
--                  tables (roles remain TEXT+CHECK on `users`, not a
--                  many-to-many RBAC schema — see rationale below).
-- ============================================================================

-- Shared trigger function: every table with an `updated_at` column uses
-- this, rather than relying on the application to remember to set it.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  -- TEXT + CHECK, not an enum: see docs/DATABASE.md "ID & type strategy" —
  -- role sets grow over time and enums are awkward to extend safely.
  role           TEXT NOT NULL CHECK (role IN ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN')),
  disabled       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email::text)) > 0)
);

-- Case-insensitive uniqueness comes from the CITEXT type itself; this index
-- both enforces it at the DB level (defense in depth beyond the app-level
-- "email already registered" check in auth.service.ts) and serves every
-- login/registration lookup by email.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email);

-- Admin dashboards list/filter by role and disabled status together
-- ("show all active Admins") — a composite index supports that directly
-- instead of the query falling back to a sequential scan.
CREATE INDEX IF NOT EXISTS users_role_disabled_idx ON users (role, disabled);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE users IS 'Customers, Admins, and Super Admins. A single table (not separate per role) because the account/auth lifecycle — password, sessions, disabling — is identical across roles; role only changes authorization, handled in application RBAC (src/lib/rbac.ts) plus the reference tables below.';
COMMENT ON COLUMN users.role IS 'CUSTOMER | ADMIN | SUPER_ADMIN. Authorization enforcement lives in application code (src/lib/rbac.ts) for performance (no DB round trip per request); permissions/role_permissions below are the auditable reference copy of that same matrix, not a second enforcement path. Keep them in sync — see docs/DATABASE.md.';

-- ---------------------------------------------------------------------------
-- addresses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  line1        TEXT NOT NULL,
  line2        TEXT,
  city         TEXT NOT NULL,
  region       TEXT NOT NULL,
  postal_code  TEXT NOT NULL,
  country      TEXT NOT NULL,
  phone        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT addresses_country_len CHECK (char_length(country) BETWEEN 2 AND 60),
  CONSTRAINT addresses_line1_not_blank CHECK (length(btrim(line1)) > 0)
);

-- Every address lookup in the app is "this user's addresses" — the FK
-- column is the entire access pattern, so one index covers it.
CREATE INDEX IF NOT EXISTS addresses_user_id_idx ON addresses (user_id);

DROP TRIGGER IF EXISTS addresses_set_updated_at ON addresses;
CREATE TRIGGER addresses_set_updated_at
  BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE addresses IS 'Customer shipping/billing addresses. ON DELETE CASCADE from users is intentional and safe: an address has no meaning independent of its owner, unlike orders (which snapshot the address text at purchase time — see orders.shipping_address_snapshot in 0005 — so deleting a user''s saved address, or the user itself, never alters historical order records).';

-- ---------------------------------------------------------------------------
-- sessions  (refresh-token sessions; access tokens are stateless — see
-- src/lib/security/tokens.ts — so only refresh sessions need persistence)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
-- Partial index: refresh/logout/admin-disable all query "this user's
-- NON-revoked sessions" — indexing only the still-relevant rows keeps this
-- index small and fast even after millions of historical sessions accumulate.
CREATE INDEX IF NOT EXISTS sessions_active_idx ON sessions (user_id) WHERE revoked = false;
-- Supports the periodic cleanup job that deletes long-expired session rows
-- (see docs/DATABASE.md "Data lifecycle" — sessions are not kept forever).
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

COMMENT ON TABLE sessions IS 'One row per issued refresh token. Revoking a row invalidates that refresh token immediately (used by logout, admin-disable, and role changes — see admin.service.ts). Rows past expires_at are inert but not auto-deleted by the database; a scheduled job should periodically DELETE WHERE expires_at < now() - retention_window (see docs/DATABASE.md).';

-- ---------------------------------------------------------------------------
-- permissions / role_permissions — auditable reference copy of the
-- authorization matrix defined in src/lib/rbac.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  code         TEXT PRIMARY KEY,
  description  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role             TEXT NOT NULL CHECK (role IN ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN')),
  permission_code  TEXT NOT NULL REFERENCES permissions(code) ON DELETE RESTRICT,
  PRIMARY KEY (role, permission_code)
);

COMMENT ON TABLE permissions IS 'Reference list of permission codes, matching PERMISSIONS in src/lib/rbac.ts.';
COMMENT ON TABLE role_permissions IS 'Reference copy of ROLE_PERMISSIONS in src/lib/rbac.ts, for admin visibility/audit (e.g. a future "view this role''s permissions" screen) and for a CI check that the two never drift apart (see docs/DATABASE.md "Keeping rbac.ts and role_permissions in sync"). NOT the enforcement path — application code enforces authorization on every request without a DB round trip.';

INSERT INTO permissions (code, description) VALUES
  ('products.read',        'View product catalog data'),
  ('products.create',      'Create new products'),
  ('products.update',      'Edit existing products'),
  ('products.delete',      'Deactivate (soft-delete) products'),
  ('orders.read',          'View any customer''s orders'),
  ('orders.read.own',      'View only the current user''s own orders'),
  ('orders.update',        'Change order status'),
  ('users.read',           'View customer account data'),
  ('users.manage',         'Modify customer accounts'),
  ('admins.manage',        'Create, disable, and change roles of Admin/Super Admin accounts'),
  ('activity_logs.read',   'View the audit/activity log'),
  ('system.manage',        'Modify system-level configuration')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('CUSTOMER', 'products.read'),
  ('CUSTOMER', 'orders.read.own'),
  ('ADMIN', 'products.read'),
  ('ADMIN', 'products.create'),
  ('ADMIN', 'products.update'),
  ('ADMIN', 'orders.read'),
  ('ADMIN', 'orders.update'),
  ('ADMIN', 'users.read'),
  ('SUPER_ADMIN', 'products.read'),
  ('SUPER_ADMIN', 'products.create'),
  ('SUPER_ADMIN', 'products.update'),
  ('SUPER_ADMIN', 'products.delete'),
  ('SUPER_ADMIN', 'orders.read'),
  ('SUPER_ADMIN', 'orders.update'),
  ('SUPER_ADMIN', 'users.read'),
  ('SUPER_ADMIN', 'users.manage'),
  ('SUPER_ADMIN', 'admins.manage'),
  ('SUPER_ADMIN', 'activity_logs.read'),
  ('SUPER_ADMIN', 'system.manage')
ON CONFLICT DO NOTHING;
