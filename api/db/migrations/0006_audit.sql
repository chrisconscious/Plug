-- ============================================================================
-- Migration 0006: Activity / audit log (append-only)
-- ============================================================================
-- Grants restricting UPDATE/DELETE on this table to nobody but a superuser
-- are applied in 0007 (after the application role exists) — see
-- docs/DATABASE.md "Database access control".

CREATE TABLE IF NOT EXISTS activity_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: an account with audit history cannot be hard-deleted. This is
  -- intentional and matches how the application actually offboards admins
  -- (admin.service.ts#setAdminDisabled sets `disabled = true`; it never
  -- deletes a user row), so this constraint should never actually be hit in
  -- normal operation — if it is, that's a signal something is trying to
  -- delete an account it shouldn't.
  actor_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role   TEXT NOT NULL CHECK (actor_role IN ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN')),
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  -- TEXT rather than a typed/polymorphic FK: targets span many unrelated
  -- tables (users, products, orders, ...). A generic FK here isn't
  -- possible in Postgres without a trigger-based polymorphic-association
  -- workaround, which adds real complexity for a field that is only ever
  -- read, never joined for referential integrity purposes.
  target_id    TEXT NOT NULL,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No updated_at, no update trigger: this table is append-only by design.
);

CREATE INDEX IF NOT EXISTS activity_logs_target_idx ON activity_logs (target_type, target_id);
CREATE INDEX IF NOT EXISTS activity_logs_actor_id_idx ON activity_logs (actor_id);
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs (created_at DESC);

COMMENT ON TABLE activity_logs IS 'Append-only audit trail. No application code path updates or deletes rows here (src/lib/audit.ts exposes only insert + read); migration 0007 additionally revokes UPDATE/DELETE at the database permission level for the application''s runtime role, so this holds even against a bug or a compromised application credential, not just by convention.';
