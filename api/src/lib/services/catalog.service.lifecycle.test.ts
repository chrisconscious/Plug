import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage/storage", () => ({ brandLogoStorage: {}, brandCampaignImageStorage: {}, productImageStorage: {} }));
vi.mock("../db/repos/catalog.repo", async () => {
  const { ConflictError } = await import("../errors");
  class ProductSlugConflictError extends ConflictError {}
  return {
    findProductById: vi.fn(),
    listVariantsForProducts: vi.fn(),
    listImagesForProduct: vi.fn(),
    updateProductFields: vi.fn(),
    archiveProduct: vi.fn(),
    restoreProduct: vi.fn(),
    setVariantStock: vi.fn(),
    toDateOnly: vi.fn(),
    ProductSlugConflictError,
  };
});
vi.mock("../db/repos/lifestyles.repo", () => ({ replaceProductLifestyles: vi.fn() }));
vi.mock("../db/repos/wishlist.repo", () => ({ listUserIdsWithProductWishlisted: vi.fn(async () => []) }));
vi.mock("./notifications.service", () => ({ notifyWishlistersProductBackInStock: vi.fn() }));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as catalogRepo from "../db/repos/catalog.repo";
import { recordAuditEvent } from "../audit";
import { updateProduct, deleteProduct, restoreProduct, setProductStock } from "./catalog.service";
import { toPrefixTsQuery } from "../db/repos/product-filter.repo";

const actor = { id: "admin-1", role: "ADMIN" as const };
const draft = { id: "p1", slug: "tee", name: "Tee", priceCents: 1000, active: false, images: [], brandId: "b", categoryId: "c" };
const variant = (stockQty: number, id = "v1") => ({ id, productId: "p1", size: "M", color: "Black", stockQty, sku: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogRepo.findProductById).mockResolvedValue(draft as never);
  vi.mocked(catalogRepo.updateProductFields).mockImplementation(async (_id, patch) => ({ ...draft, ...patch }) as never);
});

describe("publishing guard", () => {
  it("refuses to publish a product with no variants and no images, naming both", async () => {
    vi.mocked(catalogRepo.listVariantsForProducts).mockResolvedValue([]);
    vi.mocked(catalogRepo.listImagesForProduct).mockResolvedValue([]);
    const err = await updateProduct(actor, "p1", { active: true }).catch((e) => e);
    expect(err.message).toContain("isn't ready to publish");
    expect(err.fields).toMatchObject({ variants: expect.any(String), images: expect.any(String) });
    expect(catalogRepo.updateProductFields).not.toHaveBeenCalled();
  });

  it("publishes once there is at least one variant and one image", async () => {
    vi.mocked(catalogRepo.listVariantsForProducts).mockResolvedValue([variant(0)] as never);
    vi.mocked(catalogRepo.listImagesForProduct).mockResolvedValue([{ id: "i1" }] as never);
    await updateProduct(actor, "p1", { active: true });
    expect(catalogRepo.updateProductFields).toHaveBeenCalledWith("p1", { active: true });
  });

  it("does not re-check an already-live product on ordinary edits", async () => {
    vi.mocked(catalogRepo.findProductById).mockResolvedValue({ ...draft, active: true } as never);
    await updateProduct(actor, "p1", { active: true, name: "  New name " });
    expect(catalogRepo.listVariantsForProducts).not.toHaveBeenCalled();
    expect(catalogRepo.updateProductFields).toHaveBeenCalledWith("p1", { active: true, name: "New name" });
  });

  it("normalizes an edited slug and rejects one with nothing usable", async () => {
    await updateProduct(actor, "p1", { slug: "/Classic Tshirt" });
    expect(catalogRepo.updateProductFields).toHaveBeenCalledWith("p1", { slug: "classic-tshirt" });
    await expect(updateProduct(actor, "p1", { slug: "///" })).rejects.toThrow("Invalid slug");
  });
});

describe("archive / restore", () => {
  it("delete archives (never hard-deletes) and audits it", async () => {
    await deleteProduct(actor, "p1");
    expect(catalogRepo.archiveProduct).toHaveBeenCalledWith("p1");
    expect(vi.mocked(recordAuditEvent).mock.calls[0]![0]).toMatchObject({ action: "product.archived", targetId: "p1" });
  });

  it("restore brings it back as a draft", async () => {
    vi.mocked(catalogRepo.restoreProduct).mockResolvedValue({ ...draft, archivedAt: null } as never);
    const r = await restoreProduct(actor, "p1");
    expect(catalogRepo.restoreProduct).toHaveBeenCalledWith("p1");
    expect(r?.active).toBe(false);
  });
});

describe("setProductStock", () => {
  it("rejects negative, fractional and duplicate rows before touching the database", async () => {
    await expect(setProductStock(actor, "p1", [{ variantId: "v1", stockQty: -1 }])).rejects.toThrow("Invalid stock");
    await expect(setProductStock(actor, "p1", [{ variantId: "v1", stockQty: 1.5 }])).rejects.toThrow("Invalid stock");
    await expect(
      setProductStock(actor, "p1", [{ variantId: "v1", stockQty: 1 }, { variantId: "v1", stockQty: 2 }])
    ).rejects.toThrow("Duplicate");
    expect(catalogRepo.setVariantStock).not.toHaveBeenCalled();
  });

  it("writes the absolute quantities and reports derived availability", async () => {
    vi.mocked(catalogRepo.listVariantsForProducts).mockResolvedValue([variant(5)] as never);
    vi.mocked(catalogRepo.setVariantStock).mockResolvedValue([variant(0)] as never);
    const out = await setProductStock(actor, "p1", [{ variantId: "v1", stockQty: 0 }]);
    expect(catalogRepo.setVariantStock).toHaveBeenCalledWith("p1", [{ variantId: "v1", stockQty: 0 }]);
    expect(out[0]).toMatchObject({ stockQty: 0, inStock: false });
    expect(vi.mocked(recordAuditEvent).mock.calls[0]![0]).toMatchObject({
      action: "product.stock.updated",
      metadata: { changes: [{ variantId: "v1", from: 5, to: 0 }] },
    });
  });
});

describe("toPrefixTsQuery (storefront search)", () => {
  it("turns free text into a prefix query", () => {
    expect(toPrefixTsQuery("Black  Tee")).toBe("black:* & tee:*");
  });
  it("strips every tsquery operator so input can't inject syntax", () => {
    expect(toPrefixTsQuery("shirt' | !(x) & y:*")).toBe("shirt:* & x:* & y:*");
    expect(toPrefixTsQuery("!!! ::")).toBeNull();
  });
});
