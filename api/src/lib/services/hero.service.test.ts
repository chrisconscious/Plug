import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StorageProvider, StoredObject } from "../storage/provider";
import type { HeroSlide } from "../db/types";
import type { MediaRecord } from "../db/repos/media.repo";

// vi.mock factories are hoisted above everything else, so the fake they
// return must be created with vi.hoisted (a plain top-level const is
// still uninitialized when the factory runs).
const fakeHeroImageStorage = vi.hoisted(() => {
  class FakeStorageProvider implements StorageProvider {
    readonly name = "fake-hero-images";
    objects = new Map<string, Buffer>();
    async put(key: string, data: Buffer): Promise<StoredObject> {
      this.objects.set(key, data);
      return { storageKey: key, url: `https://fake.example/heroes/${key}` };
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
  return new FakeStorageProvider();
});

vi.mock("../storage/storage", () => ({
  heroImageStorage: fakeHeroImageStorage,
}));

vi.mock("../db/repos/hero.repo", () => ({
  findHeroSlideById: vi.fn(),
  updateHeroSlide: vi.fn(),
  deleteHeroSlide: vi.fn(),
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

import * as heroRepo from "../db/repos/hero.repo";
import * as mediaRepo from "../db/repos/media.repo";
import { storeHeroImage, removeHeroImage, deleteHeroSlide } from "./hero.service";

const actor = { id: "admin-1", role: "ADMIN" as const };

function makeFakePng(width = 1600, height = 800): Buffer {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function fakeHeroSlide(overrides: Partial<HeroSlide> = {}): HeroSlide {
  return {
    id: "hero-1", campaignLabel: "SALE", headline: "Big Sale", description: "desc",
    ctaText: "Shop", ctaUrl: "/shop", badgeText: null, editorialText: null,
    heroType: "promotional", imageUrl: "https://fake.example/old.png", storageKey: "old-key",
    contentType: "image/png", sizeBytes: 100, width: 1600, height: 800,
    displayOrder: 0, isActive: false, startDate: null, endDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as HeroSlide;
}

function fakeMedia(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "media-1", storageKey: "new-key", storageProvider: "fake-hero-images",
    url: "https://fake.example/heroes/new-key", originalFilename: "hero.png",
    contentType: "image/png", sizeBytes: 24, width: 1600, height: 800,
    checksumSha256: "x".repeat(64), altText: null, entityType: "hero_slide",
    entityId: "hero-1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  fakeHeroImageStorage.objects.clear();
  vi.mocked(heroRepo.findHeroSlideById).mockReset();
  vi.mocked(heroRepo.updateHeroSlide).mockReset();
  vi.mocked(heroRepo.deleteHeroSlide).mockReset();
  vi.mocked(mediaRepo.insertMedia).mockReset();
  vi.mocked(mediaRepo.findMediaByStorageKey).mockReset();
  vi.mocked(mediaRepo.deleteMedia).mockReset();
});

describe("storeHeroImage", () => {
  it("404s if the hero slide doesn't exist, without touching storage", async () => {
    vi.mocked(heroRepo.findHeroSlideById).mockResolvedValue(null);
    await expect(
      storeHeroImage(actor, "nonexistent", { data: makeFakePng() })
    ).rejects.toThrow();
    expect(fakeHeroImageStorage.objects.size).toBe(0);
  });

  it("uploads via MediaService and updates the slide with the real media metadata", async () => {
    vi.mocked(heroRepo.findHeroSlideById).mockResolvedValue(fakeHeroSlide({ storageKey: null }));
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMedia());
    vi.mocked(heroRepo.updateHeroSlide).mockResolvedValue(fakeHeroSlide({ storageKey: "new-key", imageUrl: "https://fake.example/heroes/new-key" }));

    const updated = await storeHeroImage(actor, "hero-1", { data: makeFakePng(1600, 800), filename: "hero.png" });

    expect(updated?.storageKey).toBe("new-key");
    expect(fakeHeroImageStorage.objects.size).toBe(1);
    const insertCall = vi.mocked(mediaRepo.insertMedia).mock.calls[0][0];
    expect(insertCall.entityType).toBe("hero_slide");
    expect(insertCall.entityId).toBe("hero-1");
    const updateCall = vi.mocked(heroRepo.updateHeroSlide).mock.calls[0][1];
    expect(updateCall.width).toBe(1600);
    expect(updateCall.height).toBe(800);
  });

  it("cleans up the uploaded object if the DB write fails", async () => {
    vi.mocked(heroRepo.findHeroSlideById).mockResolvedValue(fakeHeroSlide({ storageKey: null }));
    // The media row records the REAL (random) key the upload was stored
    // under, and cleanup looks that row up — mirror both like the database would.
    let inserted: ReturnType<typeof fakeMedia> | null = null;
    vi.mocked(mediaRepo.insertMedia).mockImplementation(async (input) => (inserted = fakeMedia({ storageKey: input.storageKey })));
    vi.mocked(mediaRepo.findMediaById).mockImplementation(async () => inserted);
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);
    vi.mocked(heroRepo.updateHeroSlide).mockRejectedValue(new Error("simulated DB failure"));

    await expect(
      storeHeroImage(actor, "hero-1", { data: makeFakePng() })
    ).rejects.toThrow("simulated DB failure");
    expect(fakeHeroImageStorage.objects.size).toBe(0);
  });

  it("replacing an existing image cleans up the old storage object and its media record", async () => {
    fakeHeroImageStorage.objects.set("old-key", Buffer.from("old"));
    vi.mocked(heroRepo.findHeroSlideById).mockResolvedValue(fakeHeroSlide({ storageKey: "old-key" }));
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMedia({ storageKey: "new-key" }));
    vi.mocked(heroRepo.updateHeroSlide).mockResolvedValue(fakeHeroSlide({ storageKey: "new-key" }));
    vi.mocked(mediaRepo.findMediaByStorageKey).mockResolvedValue(fakeMedia({ id: "old-media-id", storageKey: "old-key" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    await storeHeroImage(actor, "hero-1", { data: makeFakePng() });

    expect(fakeHeroImageStorage.objects.has("old-key")).toBe(false);
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("old-media-id");
  });
});

describe("removeHeroImage", () => {
  it("refuses to remove the image of an active hero slide", async () => {
    vi.mocked(heroRepo.findHeroSlideById).mockResolvedValue(fakeHeroSlide({ isActive: true }));
    await expect(removeHeroImage(actor, "hero-1")).rejects.toThrow(/active/i);
  });

  it("clears the slide's image fields and deletes the storage object + media record when inactive", async () => {
    fakeHeroImageStorage.objects.set("old-key", Buffer.from("data"));
    vi.mocked(heroRepo.findHeroSlideById).mockResolvedValue(fakeHeroSlide({ isActive: false, storageKey: "old-key" }));
    vi.mocked(heroRepo.updateHeroSlide).mockResolvedValue(fakeHeroSlide({ isActive: false, storageKey: null, imageUrl: "" }));
    vi.mocked(mediaRepo.findMediaByStorageKey).mockResolvedValue(fakeMedia({ id: "old-media-id", storageKey: "old-key" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    const updated = await removeHeroImage(actor, "hero-1");

    expect(updated?.storageKey).toBeNull();
    expect(fakeHeroImageStorage.objects.has("old-key")).toBe(false);
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("old-media-id");
  });
});

describe("deleteHeroSlide", () => {
  it("deletes the slide row, the storage object, and the media registry row", async () => {
    fakeHeroImageStorage.objects.set("key-1", Buffer.from("data"));
    vi.mocked(heroRepo.findHeroSlideById).mockResolvedValue(fakeHeroSlide({ storageKey: "key-1" }));
    vi.mocked(heroRepo.deleteHeroSlide).mockResolvedValue(true);
    vi.mocked(mediaRepo.findMediaByStorageKey).mockResolvedValue(fakeMedia({ id: "media-to-clean", storageKey: "key-1" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    await deleteHeroSlide(actor, "hero-1");

    expect(fakeHeroImageStorage.objects.has("key-1")).toBe(false);
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("media-to-clean");
  });

  it("404s if the hero slide doesn't exist", async () => {
    vi.mocked(heroRepo.findHeroSlideById).mockResolvedValue(null);
    await expect(deleteHeroSlide(actor, "nonexistent")).rejects.toThrow();
  });
});
