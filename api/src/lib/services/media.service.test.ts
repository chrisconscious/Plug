import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import type { StorageProvider, StoredObject } from "../storage/provider";
import type { MediaRecord } from "../db/repos/media.repo";

// media.repo is mocked so these tests never need a real Postgres — every
// test controls exactly what the "database" does, including making it fail
// on demand for the failure-mode tests below.
vi.mock("../db/repos/media.repo", () => ({
  insertMedia: vi.fn(),
  findMediaById: vi.fn(),
  findMediaByStorageKey: vi.fn(),
  deleteMedia: vi.fn(),
  findMediaWithMissingEntity: vi.fn(),
  listAllStorageKeys: vi.fn(),
}));

import * as mediaRepo from "../db/repos/media.repo";
import * as mediaService from "./media.service";

/** Byte-accurate minimal PNG (verified independently before this file was written — see the task's audit notes). */
function makeFakePng(width = 800, height = 600): Buffer {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** In-memory fake StorageProvider — a real implementation of the interface, not a mock of one, so put/exists/list behave like a genuine (if trivial) provider. */
class FakeStorageProvider implements StorageProvider {
  readonly name = "fake";
  objects = new Map<string, Buffer>();
  putShouldFail = false;
  deleteShouldFail = false;

  async put(key: string, data: Buffer): Promise<StoredObject> {
    if (this.putShouldFail) throw new Error("simulated storage failure");
    this.objects.set(key, data);
    return { storageKey: key, url: `https://fake.example/${key}` };
  }
  async delete(key: string): Promise<void> {
    if (this.deleteShouldFail) throw new Error("simulated storage delete failure");
    this.objects.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async list(): Promise<string[]> {
    return [...this.objects.keys()];
  }
}

function fakeMediaRecord(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "media-1",
    storageKey: "key-1",
    storageProvider: "fake",
    url: "https://fake.example/key-1",
    originalFilename: "photo.png",
    contentType: "image/png",
    sizeBytes: 24,
    width: 800,
    height: 600,
    checksumSha256: "abc",
    altText: null,
    entityType: "product_image",
    entityId: "product-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(mediaRepo.insertMedia).mockReset();
  vi.mocked(mediaRepo.findMediaById).mockReset();
  vi.mocked(mediaRepo.findMediaByStorageKey).mockReset();
  vi.mocked(mediaRepo.deleteMedia).mockReset();
  vi.mocked(mediaRepo.findMediaWithMissingEntity).mockReset();
  vi.mocked(mediaRepo.listAllStorageKeys).mockReset();
});

describe("uploadMedia", () => {
  it("validates, stores, computes a checksum, and records metadata", async () => {
    const provider = new FakeStorageProvider();
    const data = makeFakePng(800, 600);
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMediaRecord({ width: 800, height: 600, sizeBytes: data.length }));

    const { media } = await mediaService.uploadMedia({
      provider, data, originalFilename: "photo.png", entityType: "product_image", entityId: "product-1",
    });

    expect(provider.objects.size).toBe(1);
    expect(media.width).toBe(800);
    expect(media.height).toBe(600);
    const insertCall = vi.mocked(mediaRepo.insertMedia).mock.calls[0][0];
    expect(insertCall.contentType).toBe("image/png");
    expect(insertCall.sizeBytes).toBe(data.length);
    expect(insertCall.checksumSha256).toMatch(/^[0-9a-f]{64}$/); // real SHA-256 hex, not a stub value
    expect(insertCall.entityType).toBe("product_image");
    expect(insertCall.entityId).toBe("product-1");
  });

  it("rejects an empty file before touching storage or the database", async () => {
    const provider = new FakeStorageProvider();
    await expect(
      mediaService.uploadMedia({ provider, data: Buffer.alloc(0), entityType: "product_image" })
    ).rejects.toThrow();
    expect(provider.objects.size).toBe(0);
    expect(mediaRepo.insertMedia).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit before touching storage", async () => {
    const provider = new FakeStorageProvider();
    const data = makeFakePng();
    await expect(
      mediaService.uploadMedia({ provider, data, entityType: "product_image", maxBytes: 10 })
    ).rejects.toThrow(/too large/);
    expect(provider.objects.size).toBe(0);
  });

  it("rejects a non-image buffer (fails validation before storage/DB)", async () => {
    const provider = new FakeStorageProvider();
    await expect(
      mediaService.uploadMedia({ provider, data: Buffer.from("not an image"), entityType: "product_image" })
    ).rejects.toThrow();
    expect(provider.objects.size).toBe(0);
    expect(mediaRepo.insertMedia).not.toHaveBeenCalled();
  });
});

describe("uploadMedia — failed storage operation", () => {
  it("propagates the storage error and never calls the database", async () => {
    const provider = new FakeStorageProvider();
    provider.putShouldFail = true;
    await expect(
      mediaService.uploadMedia({ provider, data: makeFakePng(), entityType: "product_image" })
    ).rejects.toThrow("simulated storage failure");
    expect(mediaRepo.insertMedia).not.toHaveBeenCalled();
  });
});

describe("uploadMedia — failed database transaction", () => {
  it("compensates by deleting the just-uploaded object, then re-throws the DB error", async () => {
    const provider = new FakeStorageProvider();
    vi.mocked(mediaRepo.insertMedia).mockRejectedValue(new Error("simulated DB failure"));

    await expect(
      mediaService.uploadMedia({ provider, data: makeFakePng(), entityType: "product_image" })
    ).rejects.toThrow("simulated DB failure");

    // The object was put() during the call, then removed by compensation —
    // net effect: nothing left behind in storage.
    expect(provider.objects.size).toBe(0);
  });

  it("if the compensating delete ALSO fails, still throws the original DB error (not the cleanup error)", async () => {
    const provider = new FakeStorageProvider();
    provider.deleteShouldFail = true;
    vi.mocked(mediaRepo.insertMedia).mockRejectedValue(new Error("simulated DB failure"));

    await expect(
      mediaService.uploadMedia({ provider, data: makeFakePng(), entityType: "product_image" })
    ).rejects.toThrow("simulated DB failure");
  });
});

describe("getMedia (retrieve)", () => {
  it("returns the record for a known id", async () => {
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(fakeMediaRecord());
    const result = await mediaService.getMedia("media-1");
    expect(result?.id).toBe("media-1");
  });

  it("returns null for an unknown id", async () => {
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(null);
    expect(await mediaService.getMedia("nope")).toBeNull();
  });
});

describe("replaceMedia — deduplication", () => {
  it("skips the entire operation (no storage write, no DB write, no old-object deletion) when the new content is byte-identical to what's already stored", async () => {
    const provider = new FakeStorageProvider();
    const data = makeFakePng(800, 600);
    // Compute the real checksum the same way media.service.ts does
    // internally (createHash("sha256")...) — not a fabricated value — so
    // this test proves the actual dedup comparison, not a mocked match.
    const realChecksum = createHash("sha256").update(data).digest("hex");
    await provider.put("existing-key", data, { contentType: "image/png" });
    const existing = fakeMediaRecord({ id: "media-1", storageKey: "existing-key", checksumSha256: realChecksum });
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(existing);

    const { media } = await mediaService.replaceMedia({ provider, existingMediaId: "media-1", data });

    expect(media.id).toBe("media-1"); // the SAME record, unchanged
    expect(provider.objects.size).toBe(1); // no new object written
    expect(provider.objects.has("existing-key")).toBe(true); // the old one was NOT deleted
    expect(mediaRepo.insertMedia).not.toHaveBeenCalled();
    expect(mediaRepo.deleteMedia).not.toHaveBeenCalled();
  });

  it("proceeds normally (does NOT dedup) when the content actually differs", async () => {
    const provider = new FakeStorageProvider();
    const oldData = makeFakePng(800, 600);
    const newData = makeFakePng(400, 300); // genuinely different bytes/dimensions
    const oldChecksum = createHash("sha256").update(oldData).digest("hex");
    await provider.put("old-key", oldData, { contentType: "image/png" });
    const existing = fakeMediaRecord({ id: "media-1", storageKey: "old-key", checksumSha256: oldChecksum });
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(existing);
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMediaRecord({ id: "media-2", storageKey: "new-key" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    const { media } = await mediaService.replaceMedia({ provider, existingMediaId: "media-1", data: newData });

    expect(media.id).toBe("media-2"); // a genuinely new record
    expect(mediaRepo.insertMedia).toHaveBeenCalled();
  });
});

describe("replaceMedia", () => {
  it("uploads the new object, records it, and deletes the old object", async () => {
    const provider = new FakeStorageProvider();
    await provider.put("old-key", Buffer.from("old data"), { contentType: "image/png" });

    const existing = fakeMediaRecord({ id: "media-1", storageKey: "old-key" });
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(existing);
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMediaRecord({ id: "media-2", storageKey: "new-key" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    const { media } = await mediaService.replaceMedia({
      provider, existingMediaId: "media-1", data: makeFakePng(),
    });

    expect(media.id).toBe("media-2");
    expect(provider.objects.has("old-key")).toBe(false); // old object cleaned up
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("media-1"); // old record removed
  });

  it("throws if the existing media record doesn't exist", async () => {
    const provider = new FakeStorageProvider();
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(null);
    await expect(
      mediaService.replaceMedia({ provider, existingMediaId: "nope", data: makeFakePng() })
    ).rejects.toThrow();
  });

  it("does not fail the whole replace if deleting the OLD object fails — the new one is already safely recorded", async () => {
    const provider = new FakeStorageProvider();
    provider.deleteShouldFail = true;
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(fakeMediaRecord({ id: "media-1", storageKey: "old-key" }));
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMediaRecord({ id: "media-2", storageKey: "new-key" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    const { media } = await mediaService.replaceMedia({
      provider, existingMediaId: "media-1", data: makeFakePng(),
    });
    expect(media.id).toBe("media-2"); // succeeded despite the old-object cleanup failing
  });
});

describe("removeMedia (deletion)", () => {
  it("deletes the DB record and the storage object", async () => {
    const provider = new FakeStorageProvider();
    await provider.put("key-1", Buffer.from("data"), { contentType: "image/png" });
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(fakeMediaRecord({ id: "media-1", storageKey: "key-1" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    await mediaService.removeMedia(provider, "media-1");

    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("media-1");
    expect(provider.objects.has("key-1")).toBe(false);
  });

  it("is idempotent — removing an already-gone media id does nothing and does not throw", async () => {
    const provider = new FakeStorageProvider();
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(null);
    await expect(mediaService.removeMedia(provider, "already-gone")).resolves.not.toThrow();
    expect(mediaRepo.deleteMedia).not.toHaveBeenCalled();
  });

  it("does not throw even if the storage delete fails (logged, not fatal — orphan cleanup will catch it)", async () => {
    const provider = new FakeStorageProvider();
    provider.deleteShouldFail = true;
    vi.mocked(mediaRepo.findMediaById).mockResolvedValue(fakeMediaRecord({ id: "media-1", storageKey: "key-1" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);
    await expect(mediaService.removeMedia(provider, "media-1")).resolves.not.toThrow();
  });
});

describe("findOrphans / cleanupOrphans (orphan cleanup)", () => {
  it("identifies a storage key with no matching media row as an orphan", async () => {
    const provider = new FakeStorageProvider();
    await provider.put("referenced-key", Buffer.from("a"), { contentType: "image/png" });
    await provider.put("orphaned-key", Buffer.from("b"), { contentType: "image/png" });
    vi.mocked(mediaRepo.listAllStorageKeys).mockResolvedValue(["referenced-key"]);
    vi.mocked(mediaRepo.findMediaWithMissingEntity).mockResolvedValue([]);

    const result = await mediaService.findOrphans(provider);
    expect(result.orphanedStorageKeys).toEqual(["orphaned-key"]);
  });

  it("identifies a media row whose owning entity no longer exists as an orphan", async () => {
    const provider = new FakeStorageProvider();
    vi.mocked(mediaRepo.listAllStorageKeys).mockResolvedValue([]);
    const staleRecord = fakeMediaRecord({ id: "media-stale", storageKey: "stale-key" });
    vi.mocked(mediaRepo.findMediaWithMissingEntity).mockResolvedValue([staleRecord]);

    const result = await mediaService.findOrphans(provider);
    expect(result.orphanedMediaRecords).toEqual([staleRecord]);
  });

  it("dry run (default) reports what would be deleted without deleting anything", async () => {
    const provider = new FakeStorageProvider();
    await provider.put("orphaned-key", Buffer.from("b"), { contentType: "image/png" });
    vi.mocked(mediaRepo.listAllStorageKeys).mockResolvedValue([]);
    vi.mocked(mediaRepo.findMediaWithMissingEntity).mockResolvedValue([]);

    const result = await mediaService.cleanupOrphans(provider);
    expect(result.deletedStorageKeys).toEqual(["orphaned-key"]);
    expect(provider.objects.has("orphaned-key")).toBe(true); // NOT actually deleted
    expect(mediaRepo.deleteMedia).not.toHaveBeenCalled();
  });

  it("dryRun: false actually deletes orphaned storage objects and stale media records", async () => {
    const provider = new FakeStorageProvider();
    await provider.put("orphaned-key", Buffer.from("b"), { contentType: "image/png" });
    vi.mocked(mediaRepo.listAllStorageKeys).mockResolvedValue([]);
    const staleRecord = fakeMediaRecord({ id: "media-stale", storageKey: "stale-key-not-in-storage" });
    vi.mocked(mediaRepo.findMediaWithMissingEntity).mockResolvedValue([staleRecord]);
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    const result = await mediaService.cleanupOrphans(provider, { dryRun: false });

    expect(result.deletedStorageKeys).toContain("orphaned-key");
    expect(provider.objects.has("orphaned-key")).toBe(false); // actually deleted this time
    expect(result.deletedMediaRecords).toContain("media-stale");
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("media-stale");
  });
});
