/**
 * MediaService — validates, stores, and records metadata for every upload
 * in the app, regardless of which domain (brand logo, product image, hero
 * slide, lifestyle hero) it belongs to.
 *
 *   domain service -> MediaService -> StorageProvider -> disk/S3
 *                            \-> media.repo.ts -> Postgres (metadata only —
 *                                the file bytes never touch the database)
 *
 * This is the layer that owns the two failure-mode guarantees the rest of
 * the app gets for free:
 *   1. Storage succeeds, then the DB write fails -> the just-uploaded
 *      object is deleted (compensating action) before the error
 *      propagates. Without this, every DB failure after a successful
 *      upload would silently orphan a file forever.
 *   2. The DB write succeeds, then a best-effort storage delete (e.g. of
 *      a replaced image's old object) fails -> logged, not thrown, not
 *      silently swallowed either. The record of what should be deleted
 *      still exists nowhere else, which is exactly why orphan cleanup
 *      (see findOrphanedStorageObjects/cleanupOrphans below) exists: it
 *      reconciles storage against the database independently of any
 *      single request's success/failure.
 */
import { randomUUID, createHash } from "crypto";
import { inspectImage, ImageValidationError, stripImageMetadata } from "../security/image";
import { inspectVideo, VideoValidationError } from "../security/video";
import { ValidationError } from "../errors";
import { config } from "../config";
import { logger } from "../logger";
import * as mediaRepo from "../db/repos/media.repo";
import type { MediaEntityType, MediaRecord } from "../db/repos/media.repo";
import type { StorageProvider } from "../storage/provider";

export type UploadMediaInput = {
  provider: StorageProvider;
  data: Buffer;
  originalFilename?: string | null;
  altText?: string | null;
  entityType: MediaEntityType;
  entityId?: string | null;
  maxBytes?: number;
};

export type UploadMediaResult = {
  media: MediaRecord;
};

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function validateAndInspect(data: Buffer, maxBytes: number) {
  if (!data || data.length === 0) {
    throw new ValidationError("Validation failed.", { file: "A file is required." });
  }
  if (data.length > maxBytes) {
    throw new ValidationError(`File is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  try {
    return inspectImage(data);
  } catch (err) {
    if (err instanceof ImageValidationError) throw new ValidationError(err.message);
    throw err;
  }
}

/** Fetches one media record by id — the read-path counterpart to uploadMedia/replaceMedia/removeMedia. */
export async function getMedia(id: string): Promise<MediaRecord | null> {
  return mediaRepo.findMediaById(id);
}

/**
 * Validates, stores, and records one upload. This is the ONLY function in
 * the app that should call `provider.put()` directly for a new object —
 * every domain service goes through here so the compensation logic below
 * is never duplicated (it used to be re-implemented, inconsistently,
 * across catalog.service.ts / hero.service.ts / lifestyles.service.ts).
 */
export async function uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
  const maxBytes = input.maxBytes ?? config.uploads.maxBytes;
  const info = validateAndInspect(input.data, maxBytes);
  // Strip EXIF/metadata (GPS, camera/device info, embedded comments) before
  // anything is stored or checksummed — see security/image.ts's module
  // note for exactly what this does and does not cover. Stripping doesn't
  // touch pixel data, so `info` (computed above) remains accurate for the
  // stripped bytes; no need to re-run inspectImage().
  const data = stripImageMetadata(input.data, info.contentType);
  const checksum = sha256Hex(data);
  const key = randomUUID();

  // Step 1: storage. If this throws, nothing has been recorded anywhere —
  // propagate immediately, nothing to compensate.
  const stored = await input.provider.put(key, data, { contentType: info.contentType });

  // Step 2: metadata record. If THIS throws, the object above is now
  // unreferenced by anything — compensate by deleting it before
  // re-throwing, rather than leaving an orphan for every DB hiccup.
  let media: MediaRecord;
  try {
    media = await mediaRepo.insertMedia({
      storageKey: stored.storageKey,
      storageProvider: input.provider.name,
      url: stored.url,
      originalFilename: input.originalFilename ?? null,
      contentType: info.contentType,
      sizeBytes: data.length,
      width: info.width,
      height: info.height,
      checksumSha256: checksum,
      altText: input.altText ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
    });
  } catch (dbErr) {
    try {
      await input.provider.delete(stored.storageKey);
    } catch (cleanupErr) {
      // The compensation itself failed — now we DO have an orphan. Log it
      // loudly (not swallowed) so it's discoverable, and so orphan cleanup
      // has a trail to cross-reference if needed. The original DB error is
      // still what the caller sees — a cleanup failure shouldn't mask it.
      logger.error("media.upload.compensation_failed", {
        storageKey: stored.storageKey,
        provider: input.provider.name,
        dbError: dbErr instanceof Error ? dbErr.message : String(dbErr),
        cleanupError: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
      throw dbErr;
    }
    throw dbErr;
  }

  return { media };
}

function validateAndInspectVideo(data: Buffer, maxBytes: number) {
  if (!data || data.length === 0) {
    throw new ValidationError("Validation failed.", { file: "A file is required." });
  }
  if (data.length > maxBytes) {
    throw new ValidationError(`Video is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  try {
    return inspectVideo(data);
  } catch (err) {
    if (err instanceof VideoValidationError) throw new ValidationError(err.message);
    throw err;
  }
}

export type UploadVideoMediaInput = {
  provider: StorageProvider;
  data: Buffer;
  originalFilename?: string | null;
  entityType: MediaEntityType;
  entityId?: string | null;
  /** Videos are naturally much larger than images — defaults to a separate, more generous ceiling than config.uploads.maxBytes (see the call site for the actual default). */
  maxBytes: number;
};

/**
 * Mirrors uploadMedia's exact structure (storage -> DB record, with the
 * same storage-succeeded-but-DB-failed compensation) but for video: no
 * EXIF/metadata stripping step (not meaningful for a video container the
 * way it is for image pixel data), and width/height are recorded as null
 * since this deliberately does not parse the video stream — see
 * security/video.ts's own module comment for why that's a reasonable
 * scope limit here rather than a gap.
 */
export async function uploadVideoMedia(input: UploadVideoMediaInput): Promise<UploadMediaResult> {
  const info = validateAndInspectVideo(input.data, input.maxBytes);
  const checksum = sha256Hex(input.data);
  const key = randomUUID();

  const stored = await input.provider.put(key, input.data, { contentType: info.contentType });

  let media: MediaRecord;
  try {
    media = await mediaRepo.insertMedia({
      storageKey: stored.storageKey,
      storageProvider: input.provider.name,
      url: stored.url,
      originalFilename: input.originalFilename ?? null,
      contentType: info.contentType,
      sizeBytes: input.data.length,
      width: null,
      height: null,
      checksumSha256: checksum,
      altText: null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
    });
  } catch (dbErr) {
    try {
      await input.provider.delete(stored.storageKey);
    } catch (cleanupErr) {
      logger.error("media.upload_video.compensation_failed", {
        storageKey: stored.storageKey,
        provider: input.provider.name,
        dbError: dbErr instanceof Error ? dbErr.message : String(dbErr),
        cleanupError: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
      throw dbErr;
    }
    throw dbErr;
  }

  return { media };
}

export type ReplaceMediaInput = {
  provider: StorageProvider;
  existingMediaId: string;
  data: Buffer;
  originalFilename?: string | null;
  altText?: string | null;
  maxBytes?: number;
};

/**
 * Replaces an existing media record's file: uploads the NEW object first,
 * updates the DB row to point at it, and only THEN deletes the old object
 * — so at no point does the DB reference something that isn't there yet.
 * If the old-object delete fails, it's logged and left for orphan cleanup
 * — the replacement itself has already fully succeeded from the caller's
 * perspective, which is correct: a stale unreferenced file is a cleanup
 * task, not a reason to fail an otherwise-successful replace.
 */
export async function replaceMedia(input: ReplaceMediaInput): Promise<UploadMediaResult> {
  const existing = await mediaRepo.findMediaById(input.existingMediaId);
  if (!existing) {
    throw new ValidationError("Validation failed.", { existingMediaId: "No media record with that id." });
  }

  const maxBytes = input.maxBytes ?? config.uploads.maxBytes;
  const info = validateAndInspect(input.data, maxBytes);
  const data = stripImageMetadata(input.data, info.contentType);
  const checksum = sha256Hex(data);

  // Deduplication: if the "replacement" is byte-identical to what's already
  // stored, this is a no-op — most commonly an admin re-selecting the same
  // file by accident, or a client retry after a network blip that actually
  // succeeded the first time. Skip the entire operation rather than churn
  // through a new storage key, a new media row, and an old-object deletion
  // for content that hasn't actually changed.
  //
  // Scope note: this only short-circuits a replace against ITS OWN existing
  // file — it deliberately does NOT dedup across different entities (e.g.
  // two different products uploading the same stock photo), which would
  // mean multiple domain rows sharing one physical storage object. That
  // would require reference-counted deletion everywhere a storage object is
  // ever removed (every domain service's replace/delete path) to avoid one
  // entity's deletion silently breaking another's still-referenced image —
  // real, valuable, and NOT implemented here: the risk of getting that
  // invasive a change wrong outweighs the storage savings for this phase.
  if (checksum === existing.checksumSha256) {
    return { media: existing };
  }

  const key = randomUUID();

  const stored = await input.provider.put(key, data, { contentType: info.contentType });

  let updated: MediaRecord | null;
  try {
    updated = await mediaRepo.insertMedia({
      storageKey: stored.storageKey,
      storageProvider: input.provider.name,
      url: stored.url,
      originalFilename: input.originalFilename ?? existing.originalFilename,
      contentType: info.contentType,
      sizeBytes: data.length,
      width: info.width,
      height: info.height,
      checksumSha256: checksum,
      altText: input.altText !== undefined ? input.altText : existing.altText,
      entityType: existing.entityType,
      entityId: existing.entityId,
    });
    // The old record is superseded, not merely orphaned metadata — remove
    // it now that the new one is safely recorded.
    await mediaRepo.deleteMedia(existing.id);
  } catch (dbErr) {
    try {
      await input.provider.delete(stored.storageKey);
    } catch (cleanupErr) {
      logger.error("media.replace.compensation_failed", {
        storageKey: stored.storageKey,
        provider: input.provider.name,
        dbError: dbErr instanceof Error ? dbErr.message : String(dbErr),
        cleanupError: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
    throw dbErr;
  }

  try {
    await input.provider.delete(existing.storageKey);
  } catch (err) {
    logger.error("media.replace.old_object_delete_failed", {
      storageKey: existing.storageKey,
      provider: input.provider.name,
      error: err instanceof Error ? err.message : String(err),
    });
    // Not re-thrown: the replacement succeeded. This is exactly what
    // orphan cleanup exists to reconcile later.
  }

  return { media: updated! };
}

/**
 * Deletes a media record and its storage object. DB row goes first — if
 * storage delete then fails, we're left with an orphaned file (safe:
 * cleanup catches it) rather than a DB row pointing at a file that could
 * be deleted out from under it by a retry (unsafe: broken image).
 */
export async function removeMedia(provider: StorageProvider, mediaId: string): Promise<void> {
  const existing = await mediaRepo.findMediaById(mediaId);
  if (!existing) return; // already gone — deletion is idempotent
  await mediaRepo.deleteMedia(mediaId);
  try {
    await provider.delete(existing.storageKey);
  } catch (err) {
    logger.error("media.remove.storage_delete_failed", {
      storageKey: existing.storageKey,
      provider: provider.name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type OrphanScanResult = {
  /** Storage keys that exist in storage but have no media row referencing them. */
  orphanedStorageKeys: string[];
  /** Media rows whose owning entity (brand/product/hero/lifestyle) no longer exists. */
  orphanedMediaRecords: MediaRecord[];
};

/**
 * Reconciles storage against the database in both directions:
 *   - storage has it, DB doesn't  -> orphanedStorageKeys (dead file, safe to delete)
 *   - DB has it, owning entity doesn't -> orphanedMediaRecords (dead metadata + its file)
 * Read-only — see cleanupOrphans() to actually delete what this finds.
 */
export async function findOrphans(provider: StorageProvider): Promise<OrphanScanResult> {
  const [storageKeys, dbKeys, orphanedMediaRecords] = await Promise.all([
    provider.list(),
    mediaRepo.listAllStorageKeys(provider.name),
    mediaRepo.findMediaWithMissingEntity(),
  ]);
  const dbKeySet = new Set(dbKeys);
  const orphanedStorageKeys = storageKeys.filter((k) => !dbKeySet.has(k));
  return { orphanedStorageKeys, orphanedMediaRecords };
}

export type CleanupResult = {
  deletedStorageKeys: string[];
  deletedMediaRecords: string[];
  errors: { key: string; error: string }[];
};

/**
 * Actually deletes what findOrphans() found. `dryRun: true` (the default)
 * only reports what WOULD be deleted — orphan cleanup is exactly the kind
 * of operation that should never run destructively without an explicit
 * opt-in, since a bug in the scan logic would otherwise delete real files.
 */
export async function cleanupOrphans(provider: StorageProvider, opts: { dryRun?: boolean } = {}): Promise<CleanupResult> {
  const dryRun = opts.dryRun ?? true;
  const { orphanedStorageKeys, orphanedMediaRecords } = await findOrphans(provider);
  const result: CleanupResult = { deletedStorageKeys: [], deletedMediaRecords: [], errors: [] };

  if (dryRun) {
    result.deletedStorageKeys = orphanedStorageKeys; // reported as "would delete"
    result.deletedMediaRecords = orphanedMediaRecords.map((m) => m.id);
    return result;
  }

  for (const key of orphanedStorageKeys) {
    try {
      await provider.delete(key);
      result.deletedStorageKeys.push(key);
    } catch (err) {
      result.errors.push({ key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const rec of orphanedMediaRecords) {
    try {
      await provider.delete(rec.storageKey).catch(() => undefined); // may already be gone; fine either way
      await mediaRepo.deleteMedia(rec.id);
      result.deletedMediaRecords.push(rec.id);
    } catch (err) {
      result.errors.push({ key: rec.storageKey, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
