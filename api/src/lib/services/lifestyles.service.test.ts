import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StorageProvider, StoredObject } from "../storage/provider";
import type { Lifestyle } from "../db/types";
import type { MediaRecord } from "../db/repos/media.repo";

class FakeStorageProvider implements StorageProvider {
  readonly name = "fake-lifestyle-images";
  objects = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<StoredObject> {
    this.objects.set(key, data);
    return { storageKey: key, url: `https://fake.example/lifestyles/${key}` };
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async list(): Promise<string[]> {
    return [...this.objects.keys()];
  }
}
const fakeLifestyleImageStorage = new FakeStorageProvider();

vi.mock("../storage/storage", () => ({
  lifestyleImageStorage: fakeLifestyleImageStorage,
}));

vi.mock("../db/repos/lifestyles.repo", () => ({
  findLifestyleById: vi.fn(),
  updateLifestyleFields: vi.fn(),
  deleteLifestyleRow: vi.fn(),
  countAssignedProducts: vi.fn(),
}));

vi.mock("../db/repos/media.repo", () => ({
  insertMedia: vi.fn(),
  findMediaById: vi.fn(),
  findMediaByStorageKey: vi.fn(),
  deleteMedia: vi.fn(),
  findMediaWithMissingEntity: vi.fn(),
  listAllStorageKeys: vi.fn(),
}));

vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as lifestyleRepo from "../db/repos/lifestyles.repo";
import * as mediaRepo from "../db/repos/media.repo";
import { uploadLifestyleHero, removeLifestyleHero, deleteLifestyle } from "./lifestyles.service";

const actor = { id: "admin-1", role: "ADMIN" as const };

function makeFakePng(width = 1200, height = 900): Buffer {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function fakeLifestyle(overrides: Partial<Lifestyle> = {}): Lifestyle {
  return {
    id: "lifestyle-1", slug: "campus-life", name: "Campus Life", shortDescription: null,
    heroImageUrl: "https://fake.example/old.png", storageKey: "old-key", contentType: "image/png",
    sizeBytes: 100, width: 1200, height: 900, active: false, displayOrder: 0,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fakeMedia(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "media-1", storageKey: "new-key", storageProvider: "fake-lifestyle-images",
    url: "https://fake.example/lifestyles/new-key", originalFilename: "lifestyle.png",
    contentType: "image/png", sizeBytes: 24, width: 1200, height: 900,
    checksumSha256: "x".repeat(64), altText: null, entityType: "lifestyle_hero",
    entityId: "lifestyle-1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  fakeLifestyleImageStorage.objects.clear();
  vi.mocked(lifestyleRepo.findLifestyleById).mockReset();
  vi.mocked(lifestyleRepo.updateLifestyleFields).mockReset();
  vi.mocked(lifestyleRepo.deleteLifestyleRow).mockReset();
  vi.mocked(lifestyleRepo.countAssignedProducts).mockReset();
  vi.mocked(mediaRepo.insertMedia).mockReset();
  vi.mocked(mediaRepo.findMediaByStorageKey).mockReset();
  vi.mocked(mediaRepo.deleteMedia).mockReset();
});

describe("uploadLifestyleHero", () => {
  it("404s if the lifestyle doesn't exist, without touching storage", async () => {
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(null);
    await expect(
      uploadLifestyleHero(actor, "nonexistent", { data: makeFakePng() })
    ).rejects.toThrow();
    expect(fakeLifestyleImageStorage.objects.size).toBe(0);
  });

  it("uploads via MediaService and updates the lifestyle with the real media metadata", async () => {
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(fakeLifestyle({ storageKey: null }));
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMedia());
    vi.mocked(lifestyleRepo.updateLifestyleFields).mockResolvedValue(fakeLifestyle({ storageKey: "new-key" }));

    const updated = await uploadLifestyleHero(actor, "lifestyle-1", { data: makeFakePng(1200, 900), filename: "lifestyle.png" });

    expect(updated?.storageKey).toBe("new-key");
    expect(fakeLifestyleImageStorage.objects.size).toBe(1);
    const insertCall = vi.mocked(mediaRepo.insertMedia).mock.calls[0][0];
    expect(insertCall.entityType).toBe("lifestyle_hero");
    expect(insertCall.entityId).toBe("lifestyle-1");
  });

  it("cleans up the uploaded object if the DB write fails", async () => {
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(fakeLifestyle({ storageKey: null }));
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMedia());
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);
    vi.mocked(lifestyleRepo.updateLifestyleFields).mockRejectedValue(new Error("simulated DB failure"));

    await expect(
      uploadLifestyleHero(actor, "lifestyle-1", { data: makeFakePng() })
    ).rejects.toThrow("simulated DB failure");
    expect(fakeLifestyleImageStorage.objects.size).toBe(0);
  });

  it("replacing an existing hero cleans up the old storage object and its media record", async () => {
    fakeLifestyleImageStorage.objects.set("old-key", Buffer.from("old"));
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(fakeLifestyle({ storageKey: "old-key" }));
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMedia({ storageKey: "new-key" }));
    vi.mocked(lifestyleRepo.updateLifestyleFields).mockResolvedValue(fakeLifestyle({ storageKey: "new-key" }));
    vi.mocked(mediaRepo.findMediaByStorageKey).mockResolvedValue(fakeMedia({ id: "old-media-id", storageKey: "old-key" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    await uploadLifestyleHero(actor, "lifestyle-1", { data: makeFakePng() });

    expect(fakeLifestyleImageStorage.objects.has("old-key")).toBe(false);
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("old-media-id");
  });
});

describe("removeLifestyleHero", () => {
  it("refuses to remove the hero image of an active lifestyle", async () => {
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(fakeLifestyle({ active: true }));
    await expect(removeLifestyleHero(actor, "lifestyle-1")).rejects.toThrow(/active/i);
  });

  it("clears the hero fields and deletes the storage object + media record when inactive", async () => {
    fakeLifestyleImageStorage.objects.set("old-key", Buffer.from("data"));
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(fakeLifestyle({ active: false, storageKey: "old-key" }));
    vi.mocked(lifestyleRepo.updateLifestyleFields).mockResolvedValue(fakeLifestyle({ active: false, storageKey: null, heroImageUrl: null }));
    vi.mocked(mediaRepo.findMediaByStorageKey).mockResolvedValue(fakeMedia({ id: "old-media-id", storageKey: "old-key" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    const updated = await removeLifestyleHero(actor, "lifestyle-1");

    expect(updated?.storageKey).toBeNull();
    expect(fakeLifestyleImageStorage.objects.has("old-key")).toBe(false);
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("old-media-id");
  });
});

describe("deleteLifestyle", () => {
  it("refuses to delete a lifestyle with products still assigned", async () => {
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(fakeLifestyle());
    vi.mocked(lifestyleRepo.countAssignedProducts).mockResolvedValue(3);
    await expect(deleteLifestyle(actor, "lifestyle-1")).rejects.toThrow(/assigned/i);
  });

  it("deletes the row, the storage object, and the media registry row when nothing is assigned", async () => {
    fakeLifestyleImageStorage.objects.set("key-1", Buffer.from("data"));
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(fakeLifestyle({ storageKey: "key-1" }));
    vi.mocked(lifestyleRepo.countAssignedProducts).mockResolvedValue(0);
    vi.mocked(lifestyleRepo.deleteLifestyleRow).mockResolvedValue(true);
    vi.mocked(mediaRepo.findMediaByStorageKey).mockResolvedValue(fakeMedia({ id: "media-to-clean", storageKey: "key-1" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    await deleteLifestyle(actor, "lifestyle-1");

    expect(fakeLifestyleImageStorage.objects.has("key-1")).toBe(false);
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("media-to-clean");
  });

  it("404s if the lifestyle doesn't exist", async () => {
    vi.mocked(lifestyleRepo.findLifestyleById).mockResolvedValue(null);
    await expect(deleteLifestyle(actor, "nonexistent")).rejects.toThrow();
  });
});
