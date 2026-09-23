-- ============================================================================
-- Migration 0052: Admin product-posting limits & product ownership tracking
-- ============================================================================

-- Who created/last touched each product — previously untracked at all.
-- Nullable: existing products predate this column and have no known
-- author; a superadmin-created product also has no meaningful "admin
-- limit" story (see the service-layer exemption for SUPER_ADMIN).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS products_created_by_idx ON products (created_by);

-- One row per admin who has ever been given a non-default limit. Absence
-- of a row means "no limit" (the same as limit_type = 'NONE' would mean)
-- — so a limit only needs to be created when a Super Admin actually sets
-- one, not provisioned for every admin up front.
--
-- Usage ("how many has this admin posted") is deliberately NOT a counter
-- column here — it's computed live via COUNT(*) on products at
-- limit-check time (see catalog.service.ts). A stored counter could
-- drift from reality (a product deleted outside the normal flow, a
-- migration, a manual DB fix) in a way a live count structurally cannot.
CREATE TABLE IF NOT EXISTS admin_product_limits (
  admin_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  limit_type    TEXT NOT NULL CHECK (limit_type IN ('NONE', 'FIXED_TOTAL', 'FIXED_ACTIVE', 'PER_DAY', 'PER_MONTH')),
  max_value     INTEGER CHECK (max_value IS NULL OR max_value >= 0),
  updated_by    UUID REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_product_limits_value_pair CHECK (
    (limit_type = 'NONE' AND max_value IS NULL) OR
    (limit_type <> 'NONE' AND max_value IS NOT NULL)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON admin_product_limits TO plug_app_role;

COMMENT ON TABLE admin_product_limits IS 'Per-admin product-posting limit configuration. No row = no limit (same meaning as limit_type=NONE). Usage is computed live from products, never stored as a counter.';
COMMENT ON COLUMN products.created_by IS 'Nullable — products created before this column existed, or by a process with no admin actor, have no author on record.';
