import { query, queryOne } from "../client";

export type MediaEntityType = "brand_logo" | "product_image" | "hero_slide" | "lifestyle_hero" | "platform_branding" | "category_image" | "payment_method_icon" | "brand_campaign_image" | "hero_video" | "auth_page_settings";

export type MediaRecord = {
  id: string;
  storageKey: string;
  storageProvider: string;
  url: string;
  originalFilename: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  altText: string | null;
  entityType: MediaEntityType;
  entityId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MediaRow = {
  id: string;
  storage_key: string;
  storage_provider: string;
  url: string;
  original_filename: string | null;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  checksum_sha256: string;
  alt_text: string | null;
  entity_type: MediaEntityType;
  entity_id: string | null;
  created_at: string;
  updated_at: string;
};

function toMedia(r: MediaRow): MediaRecord {
  return {
    id: r.id,
    storageKey: r.storage_key,
    storageProvider: r.storage_provider,
    url: r.url,
    originalFilename: r.original_filename,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    width: r.width,
    height: r.height,
    checksumSha256: r.checksum_sha256,
    altText: r.alt_text,
    entityType: r.entity_type,
    entityId: r.entity_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type InsertMediaInput = {
  storageKey: string;
  storageProvider: string;
  url: string;
  originalFilename: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  altText: string | null;
  entityType: MediaEntityType;
  entityId: string | null;
};

export async function insertMedia(input: InsertMediaInput): Promise<MediaRecord> {
  const row = await queryOne<MediaRow>(
    `INSERT INTO media (
       storage_key, storage_provider, url, original_filename, content_type,
       size_bytes, width, height, checksum_sha256, alt_text, entity_type, entity_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      input.storageKey, input.storageProvider, input.url, input.originalFilename, input.contentType,
      input.sizeBytes, input.width, input.height, input.checksumSha256, input.altText, input.entityType, input.entityId,
    ]
  );
  return toMedia(row!);
}

export async function findMediaById(id: string): Promise<MediaRecord | null> {
  const row = await queryOne<MediaRow>("SELECT * FROM media WHERE id = $1", [id]);
  return row ? toMedia(row) : null;
}

export async function findMediaByStorageKey(storageProvider: string, storageKey: string): Promise<MediaRecord | null> {
  const row = await queryOne<MediaRow>(
    "SELECT * FROM media WHERE storage_provider = $1 AND storage_key = $2",
    [storageProvider, storageKey]
  );
  return row ? toMedia(row) : null;
}

/** Finds an existing, still-referenced upload with the same content (same provider + checksum) — the read side of dedup. See media.service.ts's uploadMedia() for how this avoids storing a byte-identical file twice. */
export async function findMediaByChecksum(storageProvider: string, checksumSha256: string): Promise<MediaRecord | null> {
  const row = await queryOne<MediaRow>(
    "SELECT * FROM media WHERE storage_provider = $1 AND checksum_sha256 = $2 ORDER BY created_at ASC LIMIT 1",
    [storageProvider, checksumSha256]
  );
  return row ? toMedia(row) : null;
}

export async function attachMediaToEntity(id: string, entityId: string): Promise<MediaRecord | null> {
  const row = await queryOne<MediaRow>(
    "UPDATE media SET entity_id = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, entityId]
  );
  return row ? toMedia(row) : null;
}

export async function updateAltText(id: string, altText: string | null): Promise<MediaRecord | null> {
  const row = await queryOne<MediaRow>(
    "UPDATE media SET alt_text = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, altText]
  );
  return row ? toMedia(row) : null;
}

export async function deleteMedia(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>("DELETE FROM media WHERE id = $1 RETURNING id", [id]);
  return !!row;
}

export async function deleteMediaByStorageKey(storageProvider: string, storageKey: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    "DELETE FROM media WHERE storage_provider = $1 AND storage_key = $2 RETURNING id",
    [storageProvider, storageKey]
  );
  return !!row;
}

/**
 * Media rows referencing an entity_id that no longer exists in its own
 * domain table — e.g. the brand/product/hero/lifestyle was deleted through
 * a path that didn't also clean up its media registry row. Each
 * subquery checks one domain table; a media row survives the WHERE only
 * if ITS OWN entity_type's check fails to find the row.
 */
export async function findMediaWithMissingEntity(): Promise<MediaRecord[]> {
  const rows = await query<MediaRow>(`
    SELECT m.* FROM media m
    WHERE m.entity_id IS NOT NULL
      AND (
        (m.entity_type = 'brand_logo' AND NOT EXISTS (SELECT 1 FROM brands b WHERE b.id = m.entity_id))
        OR (m.entity_type = 'product_image' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = m.entity_id))
        OR (m.entity_type = 'hero_slide' AND NOT EXISTS (SELECT 1 FROM hero_advertisements h WHERE h.id = m.entity_id))
        OR (m.entity_type = 'lifestyle_hero' AND NOT EXISTS (SELECT 1 FROM lifestyles l WHERE l.id = m.entity_id))
      )
  `);
  return rows.map(toMedia);
}

/** Media rows never attached to anything (entity_id still NULL) older than the given cutoff — abandoned upload-before-attach flows. */
export async function findUnattachedMediaOlderThan(cutoff: Date): Promise<MediaRecord[]> {
  const rows = await query<MediaRow>(
    "SELECT * FROM media WHERE entity_id IS NULL AND created_at < $1",
    [cutoff.toISOString()]
  );
  return rows.map(toMedia);
}

/** Every storage key currently recorded for one provider — the DB side of orphan detection (compare against StorageProvider.list()). */
export async function listAllStorageKeys(storageProvider: string): Promise<string[]> {
  const rows = await query<{ storage_key: string }>(
    "SELECT storage_key FROM media WHERE storage_provider = $1",
    [storageProvider]
  );
  return rows.map((r) => r.storage_key);
}
