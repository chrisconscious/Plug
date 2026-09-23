/**
 * StorageProvider — the ONE interface all object storage goes through.
 *
 * Business logic (MediaService, and the domain services that predate it —
 * see storage.ts) never imports `fs`, an S3 SDK, or any provider-specific
 * type. It only ever sees this interface, so swapping local disk for S3 (or
 * R2, or any other S3-compatible endpoint) is a config change
 * (`STORAGE_PROVIDER=s3` + credentials), never a code change.
 *
 * Chosen at startup by `getStorageProvider()` based on `config.storage`.
 */
export type StoredObject = {
  /** Object-storage key (never the client's original filename — that's tracked separately in the media metadata). */
  storageKey: string;
  /** Public URL the frontend loads. */
  url: string;
};

export interface StorageProvider {
  put(key: string, data: Buffer, opts: { contentType: string }): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  /** Idempotent existence check — used by replace/delete flows and orphan cleanup. */
  exists(key: string): Promise<boolean>;
  /**
   * Lists every key currently in storage (optionally under a prefix).
   * This is the operation orphan cleanup needs — "what's actually out
   * there" — and it's the one operation that's meaningfully different
   * per provider (a directory walk vs. a paginated bucket List call), so
   * it's part of the interface rather than bolted on separately.
   */
  list(prefix?: string): Promise<string[]>;
  /** Human-readable name for logs/audit metadata (e.g. "local-disk", "s3"). */
  readonly name: string;
}
