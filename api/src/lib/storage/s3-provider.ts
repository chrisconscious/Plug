/**
 * S3-compatible object storage — works with real AWS S3, Cloudflare R2,
 * MinIO, Backblaze B2, or anything else speaking the S3 API, via
 * `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE` (see .env.example).
 *
 * ⚠️ VERIFICATION STATUS: this file was written against the documented,
 * stable `@aws-sdk/client-s3` v3 API surface, but this development
 * environment has no network access to install the SDK or test against
 * real credentials/a real bucket. It has NOT been executed. Treat it as a
 * correct-by-review starting point, not a verified-working integration,
 * until it's actually run against a real (or MinIO/local) S3 endpoint.
 * This is stated here deliberately rather than glossed over — see the
 * project's TESTING.md for the same standard applied elsewhere.
 *
 * Requires the `@aws-sdk/client-s3` package (added to package.json;
 * `npm install` must be run somewhere with network access before this can
 * actually be used).
 */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { StorageProvider, StoredObject } from "./provider";

export type S3ProviderConfig = {
  bucket: string;
  region: string;
  /** Custom endpoint for non-AWS S3-compatible services (R2, MinIO, B2). Omit for real AWS S3. */
  endpoint?: string;
  /** R2/MinIO typically need path-style addressing (bucket in the URL path, not a subdomain). AWS S3 does not. */
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Base URL the frontend will actually load images from — either the
   * bucket's public URL/custom domain, or a CDN in front of it. This
   * app never generates presigned GET URLs for public product/hero
   * images (they're meant to be public and cacheable); presigned URLs
   * would be the right call for genuinely private media, which nothing
   * in this codebase currently is.
   */
  publicBaseUrl: string;
  keyPrefix?: string;
};

export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly keyPrefix: string;

  constructor(cfg: S3ProviderConfig) {
    this.bucket = cfg.bucket;
    this.publicBaseUrl = cfg.publicBaseUrl.replace(/\/$/, "");
    this.keyPrefix = cfg.keyPrefix ? cfg.keyPrefix.replace(/\/$/, "") + "/" : "";
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  private fullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async put(key: string, data: Buffer, opts: { contentType: string }): Promise<StoredObject> {
    const fullKey = this.fullKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
        Body: data,
        ContentType: opts.contentType,
        // No ACL set here deliberately — bucket-level public-read policy
        // (documented in .env.example / deployment docs) is the
        // recommended approach; per-object ACLs are legacy S3 behavior
        // that R2 and some other S3-compatible providers don't support.
      })
    );
    return { storageKey: key, url: `${this.publicBaseUrl}/${fullKey}` };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }));
      return true;
    } catch (err: unknown) {
      // The SDK throws a "NotFound" (404) error for a missing object —
      // that's the one case that means "doesn't exist"; any other error
      // (auth failure, network issue, wrong bucket) should NOT be
      // silently interpreted as "doesn't exist" — it should surface.
      const name = (err as { name?: string })?.name;
      const statusCode = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (name === "NotFound" || statusCode === 404) return false;
      throw err;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const fullPrefix = this.fullKey(prefix ?? "");
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fullPrefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(this.keyPrefix ? obj.Key.slice(this.keyPrefix.length) : obj.Key);
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }
}
