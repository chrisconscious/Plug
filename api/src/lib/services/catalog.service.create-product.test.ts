import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Product } from "../db/types";

vi.mock("../storage/storage", () => ({
  brandLogoStorage: {},
  brandCampaignImageStorage: {},
  productImageStorage: {},
}));

vi.mock("../db/repos/catalog.repo", async () => {
  const { ConflictError } = await import("../errors");
  class ProductSlugConflictError extends ConflictError {
    constructor() {
      super("A product with this slug already exists.");
    }
  }
  return { insertProduct: vi.fn(), toDateOnly: vi.fn(), ProductSlugConflictError };
});
vi.mock("../db/repos/lifestyles.repo", () => ({ replaceProductLifestyles: vi.fn() }));
vi.mock("../db/repos/admin-product-limits.repo", () => ({ getLimit: vi.fn(async () => null), countProductsForAdmin: vi.fn() }));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as catalogRepo from "../db/repos/catalog.repo";
import { ConflictError } from "../errors";
import { validateBody, optional, isStringArray } from "../validate";
import { createProduct, slugifyProduct } from "./catalog.service";

const insertProduct = vi.mocked(catalogRepo.insertProduct);
const actor = { id: "admin-1", role: "ADMIN" as const };
const baseInput = { name: "Classic Tee", brandId: "b1", categoryId: "c1", priceCents: 25000, genderAudiences: ["men"], tags: [] };

describe("createProduct", () => {
  beforeEach(() => {
    insertProduct.mockReset();
    insertProduct.mockImplementation(async (input) => ({ id: "p1", slug: input.slug, priceCents: input.priceCents }) as Product);
  });

  it("derives the slug from the name when none is given", async () => {
    const product = await createProduct(actor, baseInput);
    expect(product.slug).toBe("classic-tee");
  });

  it("normalizes a typed slug into a URL-safe key", async () => {
    const product = await createProduct(actor, { ...baseInput, slug: "  Été Tee!! " });
    expect(product.slug).toBe("ete-tee");
  });

  it("retries with a suffixed slug instead of failing when the slug is taken", async () => {
    insertProduct.mockRejectedValueOnce(new catalogRepo.ProductSlugConflictError());
    const product = await createProduct(actor, baseInput);
    expect(insertProduct).toHaveBeenCalledTimes(2);
    expect(product.slug).toMatch(/^classic-tee-[0-9a-f]{8}$/);
  });

  it("does not retry other conflicts (e.g. duplicate SKU)", async () => {
    insertProduct.mockRejectedValueOnce(new ConflictError("A product with this SKU already exists."));
    await expect(createProduct(actor, baseInput)).rejects.toThrow("SKU");
    expect(insertProduct).toHaveBeenCalledTimes(1);
  });
});

describe("slugifyProduct", () => {
  it("returns an empty string for names with no ASCII letters or digits", () => {
    expect(slugifyProduct("!!!")).toBe("");
  });
});

describe("create-product tags validation", () => {
  it("accepts an empty tags list (form submitted with no collection tags)", () => {
    expect(validateBody({ tags: [] }, { tags: optional(isStringArray) })).toEqual({ tags: [] });
  });
});
