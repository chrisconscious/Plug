import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/catalog.repo", () => ({
  findProductsByIds: vi.fn(),
  listVariantsForProducts: vi.fn(),
  listBrands: vi.fn(),
  listCategories: vi.fn(),
  listImagesForProducts: vi.fn(),
  listAudiencesForProducts: vi.fn(),
}));
vi.mock("../db/repos/lifestyles.repo", () => ({
  listLifestylesForProducts: vi.fn(),
}));

import * as catalogRepo from "../db/repos/catalog.repo";
import * as lifestyleRepo from "../db/repos/lifestyles.repo";
import { getPublicProductsByIds } from "./catalog.service";

function fakeProduct(overrides: Partial<{ id: string; brandId: string; categoryId: string; priceCents: number }> = {}) {
  return {
    id: "product-1", slug: "product-1", name: "Product 1", brandId: "brand-1", categoryId: "cat-1",
    priceCents: 1000, compareAtPriceCents: null, sku: null, badgeText: null, offerLabel: null,
    offerStartDate: null, offerEndDate: null, shortDescription: null, fullDescription: null,
    active: true, tags: [], images: [], genderAudiences: [], lifestyles: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(catalogRepo.findProductsByIds).mockReset();
  vi.mocked(catalogRepo.listVariantsForProducts).mockReset().mockResolvedValue([]);
  vi.mocked(catalogRepo.listBrands).mockReset();
  vi.mocked(catalogRepo.listCategories).mockReset();
  vi.mocked(catalogRepo.listImagesForProducts).mockReset().mockResolvedValue(new Map());
  vi.mocked(catalogRepo.listAudiencesForProducts).mockReset().mockResolvedValue(new Map());
  vi.mocked(lifestyleRepo.listLifestylesForProducts).mockReset().mockResolvedValue(new Map());
});

describe("getPublicProductsByIds — genuinely batched, not secretly N+1", () => {
  it("calls listBrands/listCategories exactly ONCE regardless of how many product ids are requested", async () => {
    vi.mocked(catalogRepo.findProductsByIds).mockResolvedValue([
      fakeProduct({ id: "p1", brandId: "b1", categoryId: "c1" }),
      fakeProduct({ id: "p2", brandId: "b2", categoryId: "c2" }),
      fakeProduct({ id: "p3", brandId: "b1", categoryId: "c1" }),
    ]);
    vi.mocked(catalogRepo.listBrands).mockResolvedValue([{ id: "b1", slug: "b1", name: "Brand 1" }, { id: "b2", slug: "b2", name: "Brand 2" }] as any);
    vi.mocked(catalogRepo.listCategories).mockResolvedValue([{ id: "c1", slug: "c1", name: "Cat 1" }, { id: "c2", slug: "c2", name: "Cat 2" }] as any);

    await getPublicProductsByIds(["p1", "p2", "p3"]);

    expect(catalogRepo.listBrands).toHaveBeenCalledTimes(1);
    expect(catalogRepo.listCategories).toHaveBeenCalledTimes(1);
    expect(catalogRepo.findProductsByIds).toHaveBeenCalledTimes(1);
  });

  it("deduplicates repeated ids before querying (a wishlist can't have duplicates, but this is cheap insurance)", async () => {
    vi.mocked(catalogRepo.findProductsByIds).mockResolvedValue([fakeProduct({ id: "p1" })]);
    vi.mocked(catalogRepo.listBrands).mockResolvedValue([]);
    vi.mocked(catalogRepo.listCategories).mockResolvedValue([]);

    await getPublicProductsByIds(["p1", "p1", "p1"]);

    expect(catalogRepo.findProductsByIds).toHaveBeenCalledWith(["p1"]);
  });

  it("returns an empty map without querying anything for an empty input", async () => {
    const result = await getPublicProductsByIds([]);
    expect(result.size).toBe(0);
    expect(catalogRepo.findProductsByIds).not.toHaveBeenCalled();
  });
});

describe("getPublicProductsByIds — correctness: each product gets its OWN data, never mixed with another's", () => {
  it("assigns each product its own brand, category, and variants — not another product's", async () => {
    vi.mocked(catalogRepo.findProductsByIds).mockResolvedValue([
      fakeProduct({ id: "p1", brandId: "b1", categoryId: "c1" }),
      fakeProduct({ id: "p2", brandId: "b2", categoryId: "c2" }),
    ]);
    vi.mocked(catalogRepo.listBrands).mockResolvedValue([
      { id: "b1", slug: "b1", name: "Brand One" },
      { id: "b2", slug: "b2", name: "Brand Two" },
    ] as any);
    vi.mocked(catalogRepo.listCategories).mockResolvedValue([
      { id: "c1", slug: "c1", name: "Category One" },
      { id: "c2", slug: "c2", name: "Category Two" },
    ] as any);
    vi.mocked(catalogRepo.listVariantsForProducts).mockResolvedValue([
      { id: "v1", productId: "p1", size: "M", color: "Red", stockQty: 5 },
      { id: "v2", productId: "p2", size: "L", color: "Blue", stockQty: 3 },
    ] as any);

    const result = await getPublicProductsByIds(["p1", "p2"]);

    expect(result.get("p1")?.brand?.name).toBe("Brand One");
    expect(result.get("p1")?.variants).toHaveLength(1);
    expect(result.get("p1")?.variants[0].color).toBe("Red");

    expect(result.get("p2")?.brand?.name).toBe("Brand Two");
    expect(result.get("p2")?.variants).toHaveLength(1);
    expect(result.get("p2")?.variants[0].color).toBe("Blue");
  });

  it("omits a requested id from the result map if the product no longer exists (not a thrown error, not a null entry)", async () => {
    vi.mocked(catalogRepo.findProductsByIds).mockResolvedValue([fakeProduct({ id: "p1" })]); // p2 not returned — deleted
    vi.mocked(catalogRepo.listBrands).mockResolvedValue([]);
    vi.mocked(catalogRepo.listCategories).mockResolvedValue([]);

    const result = await getPublicProductsByIds(["p1", "p2"]);

    expect(result.has("p1")).toBe(true);
    expect(result.has("p2")).toBe(false);
  });
});
