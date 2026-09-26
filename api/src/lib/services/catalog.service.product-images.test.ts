import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StorageProvider, StoredObject } from "../storage/provider";
import type { Product, ProductImage } from "../db/types";
import type { MediaRecord } from "../db/repos/media.repo";

/**
 * These tests mock only the outer boundaries — the database repo and the
 * raw storage backend — and let the REAL MediaService run in between. That
 * is deliberate: the point is to prove catalog.service.ts's product-image
 * functions are correctly wired into MediaService (right arguments, right
 * error handling on both sides), not to re-test MediaService's own internal
 * logic again (that's media.service.test.ts's job).
 */

// vi.mock factories are hoisted above everything else, so the fake they
// return must be created with vi.hoisted (a plain top-level const is
// still uninitialized when the factory runs).
const fakeProductImageStorage = vi.hoisted(() => {
  class FakeStorageProvider implements StorageProvider {
    readonly name = "fake-product-images";
    objects = new Map<string, Buffer>();
    async put(key: string, data: Buffer): Promise<StoredObject> {
      this.objects.set(key, data);
      return { storageKey: key, url: `https://fake.example/products/${key}` };
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
  brandLogoStorage: { name: "fake-brand", put: vi.fn(), delete: vi.fn(), exists: vi.fn(), list: vi.fn() },
  productImageStorage: fakeProductImageStorage,
}));

vi.mock("../db/repos/catalog.repo", () => ({
  findProductById: vi.fn(),
  appendProductImage: vi.fn(),
  findProductImageById: vi.fn(),
  updateProductImageFile: vi.fn(),
  deleteProductImageRow: vi.fn(),
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

import * as catalogRepo from "../db/repos/catalog.repo";
import * as mediaRepo from "../db/repos/media.repo";
import { uploadProductImage, replaceProductImage, deleteProductImage } from "./catalog.service";

const actor = { id: "admin-1", role: "ADMIN" as const };

function makeFakePng(width = 400, height = 300): Buffer {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return { id: "product-1", slug: "test-product", name: "Test Product" } as Product & typeof overrides;
}

function fakeProductImage(overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    id: "image-1", productId: "product-1", url: "https://fake.example/old.png", position: 0,
    altText: null, storageKey: "old-key", contentType: "image/png", sizeBytes: 100,
    width: 400, height: 300, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fakeMedia(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "media-1", storageKey: "new-key", storageProvider: "fake-product-images",
    url: "https://fake.example/products/new-key", originalFilename: "photo.png",
    contentType: "image/png", sizeBytes: 24, width: 400, height: 300,
    checksumSha256: "x".repeat(64), altText: null, entityType: "product_image",
    entityId: "product-1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  fakeProductImageStorage.objects.clear();
  vi.mocked(catalogRepo.findProductById).mockReset();
  vi.mocked(catalogRepo.appendProductImage).mockReset();
  vi.mocked(catalogRepo.findProductImageById).mockReset();
  vi.mocked(catalogRepo.updateProductImageFile).mockReset();
  vi.mocked(catalogRepo.deleteProductImageRow).mockReset();
  vi.mocked(mediaRepo.insertMedia).mockReset();
  vi.mocked(mediaRepo.findMediaByStorageKey).mockReset();
  vi.mocked(mediaRepo.deleteMedia).mockReset();
});

describe("uploadProductImage", () => {
  it("404s if the product doesn't exist, without touching storage", async () => {
    vi.mocked(catalogRepo.findProductById).mockResolvedValue(null);
    await expect(
      uploadProductImage(actor, "nonexistent", { data: makeFakePng() })
    ).rejects.toThrow();
    expect(fakeProductImageStorage.objects.size).toBe(0);
  });

  it("uploads via MediaService and appends the image row with the real media metadata", async () => {
    vi.mocked(catalogRepo.findProductById).mockResolvedValue(fakeProduct());
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMedia());
    vi.mocked(catalogRepo.appendProductImage).mockResolvedValue(fakeProductImage({ id: "image-2", storageKey: "new-key" }));

    const image = await uploadProductImage(actor, "product-1", {
      data: makeFakePng(400, 300), filename: "photo.png",
    });

    expect(image.id).toBe("image-2");
    expect(fakeProductImageStorage.objects.size).toBe(1); // the file genuinely landed in storage
    const insertCall = vi.mocked(mediaRepo.insertMedia).mock.calls[0][0];
    expect(insertCall.entityType).toBe("product_image");
    expect(insertCall.entityId).toBe("product-1");
    expect(insertCall.originalFilename).toBe("photo.png");
    const appendCall = vi.mocked(catalogRepo.appendProductImage).mock.calls[0][0];
    expect(appendCall.width).toBe(400);
    expect(appendCall.height).toBe(300);
  });

  it("cleans up the uploaded object if appendProductImage (the DB write) fails", async () => {
    vi.mocked(catalogRepo.findProductById).mockResolvedValue(fakeProduct());
    // The media row records the REAL (random) key the upload was stored
    // under, and cleanup looks that row up — mirror both like the database would.
    let inserted: ReturnType<typeof fakeMedia> | null = null;
    vi.mocked(mediaRepo.insertMedia).mockImplementation(async (input) => (inserted = fakeMedia({ storageKey: input.storageKey })));
    vi.mocked(mediaRepo.findMediaById).mockImplementation(async () => inserted);
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);
    vi.mocked(catalogRepo.appendProductImage).mockRejectedValue(new Error("simulated DB failure"));

    await expect(
      uploadProductImage(actor, "product-1", { data: makeFakePng() })
    ).rejects.toThrow("simulated DB failure");

    // Compensation ran: the object MediaService put() during the call was removed.
    expect(fakeProductImageStorage.objects.size).toBe(0);
  });
});

describe("replaceProductImage", () => {
  it("uploads the new image, updates the row, and cleans up the old object + its media record", async () => {
    fakeProductImageStorage.objects.set("old-key", Buffer.from("old"));
    vi.mocked(catalogRepo.findProductImageById).mockResolvedValue(fakeProductImage({ storageKey: "old-key" }));
    vi.mocked(mediaRepo.insertMedia).mockResolvedValue(fakeMedia({ storageKey: "new-key" }));
    vi.mocked(catalogRepo.updateProductImageFile).mockResolvedValue(fakeProductImage({ storageKey: "new-key" }));
    vi.mocked(mediaRepo.findMediaByStorageKey).mockResolvedValue(fakeMedia({ id: "old-media-id", storageKey: "old-key" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    const updated = await replaceProductImage(actor, "image-1", { data: makeFakePng() });

    expect(updated?.storageKey).toBe("new-key");
    expect(fakeProductImageStorage.objects.has("old-key")).toBe(false); // old object cleaned up
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("old-media-id"); // old media row cleaned up
  });

  it("404s if the image doesn't exist", async () => {
    vi.mocked(catalogRepo.findProductImageById).mockResolvedValue(null);
    await expect(
      replaceProductImage(actor, "nonexistent", { data: makeFakePng() })
    ).rejects.toThrow();
  });
});

describe("deleteProductImage", () => {
  it("deletes the row, the storage object, and the old media registry row", async () => {
    fakeProductImageStorage.objects.set("key-1", Buffer.from("data"));
    vi.mocked(catalogRepo.findProductImageById).mockResolvedValue(fakeProductImage({ storageKey: "key-1" }));
    vi.mocked(catalogRepo.deleteProductImageRow).mockResolvedValue({ deleted: true, storageKey: "key-1", productId: "product-1", position: 0 });
    vi.mocked(mediaRepo.findMediaByStorageKey).mockResolvedValue(fakeMedia({ id: "media-to-clean", storageKey: "key-1" }));
    vi.mocked(mediaRepo.deleteMedia).mockResolvedValue(true);

    await deleteProductImage(actor, "image-1");

    expect(fakeProductImageStorage.objects.has("key-1")).toBe(false);
    expect(mediaRepo.deleteMedia).toHaveBeenCalledWith("media-to-clean");
  });

  it("404s if the image doesn't exist", async () => {
    vi.mocked(catalogRepo.findProductImageById).mockResolvedValue(null);
    await expect(deleteProductImage(actor, "nonexistent")).rejects.toThrow();
  });
});
