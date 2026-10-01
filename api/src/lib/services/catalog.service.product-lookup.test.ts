import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Product } from "../db/types";

vi.mock("../storage/storage", () => ({
  brandLogoStorage: {},
  brandCampaignImageStorage: {},
  productImageStorage: {},
}));
vi.mock("../db/repos/catalog.repo", () => ({
  findProductBySlug: vi.fn(),
  findProductById: vi.fn(),
  listVariantsForProducts: vi.fn(async () => []),
  listBrands: vi.fn(async () => []),
  listCategories: vi.fn(async () => []),
  listImagesForProducts: vi.fn(async () => new Map()),
  listAudiencesForProducts: vi.fn(async () => new Map()),
  toDateOnly: vi.fn(),
}));
vi.mock("../db/repos/lifestyles.repo", () => ({ listLifestylesForProducts: vi.fn(async () => new Map()) }));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as catalogRepo from "../db/repos/catalog.repo";
import { getProductBySlug, productLookupKeys } from "./catalog.service";
import { NotFoundError } from "../errors";

const bySlug = vi.mocked(catalogRepo.findProductBySlug);
const byId = vi.mocked(catalogRepo.findProductById);
const ID = "3d6f1358-2b6f-467b-a722-42095ca0e450";
const product = (over: Partial<Product> = {}) => ({ id: ID, slug: "classic-tshirt", name: "Classic Tshirt", active: true, priceCents: 1000, tags: [], ...over }) as unknown as Product;

describe("productLookupKeys", () => {
  it("tries the slug as given, then its canonical form", () => {
    expect(productLookupKeys("/Classic Tshirt")).toEqual({ slugs: ["/Classic Tshirt", "classic-tshirt"], id: null });
    expect(productLookupKeys("lema-watch")).toEqual({ slugs: ["lema-watch"], id: null });
  });

  it("recognises a product id", () => {
    expect(productLookupKeys(ID).id).toBe(ID);
    expect(productLookupKeys("not-a-uuid").id).toBeNull();
  });
});

describe("getProductBySlug", () => {
  beforeEach(() => { bySlug.mockReset(); byId.mockReset(); });

  it("opens a product saved with a legacy slug via its canonical slug", async () => {
    bySlug.mockImplementation(async (s: string) => (s === "classic-tshirt" ? product() : null));
    const p = await getProductBySlug("/Classic Tshirt");
    expect(p.slug).toBe("classic-tshirt");
    expect(byId).not.toHaveBeenCalled();
  });

  it("resolves an active product by id", async () => {
    bySlug.mockResolvedValue(null);
    byId.mockResolvedValue(product({ slug: "lema-watch" }));
    expect((await getProductBySlug(ID)).slug).toBe("lema-watch");
  });

  it("does not expose an inactive product by id", async () => {
    bySlug.mockResolvedValue(null);
    byId.mockResolvedValue(product({ active: false }));
    await expect(getProductBySlug(ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("still 404s an unknown slug", async () => {
    bySlug.mockResolvedValue(null);
    await expect(getProductBySlug("nothing-here")).rejects.toBeInstanceOf(NotFoundError);
    expect(byId).not.toHaveBeenCalled();
  });
});
