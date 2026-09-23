-- ============================================================================
-- Migration 0023: Media registry.
--
-- Centralizes upload metadata (original filename, checksum, dimensions,
-- alt text, which entity it belongs to) in one table, backing the new
-- MediaService / StorageProvider abstraction (see
-- src/lib/services/media.service.ts, src/lib/storage/provider.ts).
--
-- Deliberately NOT a replacement for the existing storage_key columns on
-- brand_logos / product_images / hero_advertisements / lifestyles — those
-- remain each domain's own source of truth for "what image does THIS
-- brand/product/hero/lifestyle currently have" (rewriting all four to a
-- foreign-key join against this table would be a large, working-code
-- rewrite for no immediate benefit — see docs/ARCHITECTURE.md's own
-- stated preference against that). This table exists for the concerns
-- that cut across all four: checksums, orphan detection (a storage
-- object with no domain table referencing it), and a browsable media
-- audit trail — see media.repo.ts's findOrphanedMedia().
-- ============================================================================

CREATE TABLE IF NOT EXISTS media (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key       TEXT NOT NULL,
  storage_provider  TEXT NOT NULL, -- "local-disk" | "s3" — which StorageProvider wrote this (see provider.ts's `name`)
  url               TEXT NOT NULL,
  original_filename TEXT,          -- the client's filename, if the upload provided one — NEVER used as the storage key itself
  content_type      TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  width             INTEGER,
  height            INTEGER,
  checksum_sha256   TEXT NOT NULL, -- hex-encoded SHA-256 of the file content — integrity check + cheap dedup signal
  alt_text          TEXT,
  entity_type       TEXT NOT NULL, -- 'brand_logo' | 'product_image' | 'hero_slide' | 'lifestyle_hero' | 'platform_branding' (added in migration 0029 — entity_id is NULL for this type, since platform_settings is a singleton with nothing to key by) | 'category_image' (added in migration 0031 — entity_id is the category's id)
  entity_id         UUID,          -- nullable: set once the upload is attached to its owning row; NULL briefly during upload-before-attach flows
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (storage_provider, storage_key)
);

CREATE INDEX IF NOT EXISTS media_entity_idx ON media (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS media_checksum_idx ON media (checksum_sha256);
CREATE INDEX IF NOT EXISTS media_created_at_idx ON media (created_at);

COMMENT ON TABLE media IS 'Centralized upload metadata/audit registry — see migration 0023 header comment for why this is parallel to, not a replacement for, each domain table''s own storage_key column.';
COMMENT ON COLUMN media.entity_id IS 'The owning row''s id in its domain table (brands.id, products.id, hero_advertisements.id, lifestyles.id) — NOT a database foreign key, since entity_type determines which table, and Postgres has no native polymorphic FK. Referential integrity for this column is enforced in application code (media.service.ts), same pattern as activity_logs.target_id.';
