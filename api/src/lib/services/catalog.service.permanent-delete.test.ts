import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage/storage", () => ({
  brandLogoStorage: {},
  brandCampaignImageStorage: {},
  productImageStorage: { name: "local-disk", delete: vi.fn(async () => undefined) },
}));
vi.mock("../db/repos/catalog.repo", () => ({
  findProductById: vi.fn(),
  deleteArchivedProduct: vi.fn(),
  toDateOnly: vi.fn(),
}));
vi.mock("../db/repos/media.repo", () => ({ deleteMediaByStorageKey: vi.fn(async () => true) }));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as catalogRepo from "../db/repos/catalog.repo";
import * as mediaRepo from "../db/repos/media.repo";
import { productImageStorage } from "../storage/storage";
import { recordAuditEvent } from "../audit";
import { permanentlyDeleteProduct } from "./catalog.service";

const superAdmin = { id: "s1", role: "SUPER_ADMIN" as const };
const archived = { id: "p1", slug: "belt", name: "Belt", archivedAt: "2026-10-01T00:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogRepo.findProductById).mockResolvedValue(archived as never);
  vi.mocked(catalogRepo.deleteArchivedProduct).mockResolvedValue({ deleted: true, imageStorageKeys: ["a.webp", "b.webp"] });
});

describe("permanentlyDeleteProduct", () => {
  it("deletes an archived product, its image files and media rows, and audits it", async () => {
    await permanentlyDeleteProduct(superAdmin, "p1");
    expect(catalogRepo.deleteArchivedProduct).toHaveBeenCalledWith("p1");
    expect(productImageStorage.delete).toHaveBeenCalledTimes(2);
    expect(mediaRepo.deleteMediaByStorageKey).toHaveBeenCalledWith("local-disk", "a.webp");
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "product.deleted", targetId: "p1" }));
  });

  it("is Super Admin only", async () => {
    await expect(permanentlyDeleteProduct({ id: "a1", role: "ADMIN" }, "p1")).rejects.toThrow(/Super Admin/);
    expect(catalogRepo.deleteArchivedProduct).not.toHaveBeenCalled();
  });

  it("refuses a product that isn't archived", async () => {
    vi.mocked(catalogRepo.findProductById).mockResolvedValue({ ...archived, archivedAt: null } as never);
    await expect(permanentlyDeleteProduct(superAdmin, "p1")).rejects.toThrow(/Archive it first/);
    expect(catalogRepo.deleteArchivedProduct).not.toHaveBeenCalled();
  });

  it("reports not found when the row is gone", async () => {
    vi.mocked(catalogRepo.findProductById).mockResolvedValue(null);
    await expect(permanentlyDeleteProduct(superAdmin, "p1")).rejects.toThrow(/not found/);
  });
});
