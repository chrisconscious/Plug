import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/cart.repo", () => ({
  listCartItems: vi.fn(),
  upsertCartItem: vi.fn(),
  updateCartItemQuantity: vi.fn(),
  deleteCartItem: vi.fn(),
  findCartItemById: vi.fn(),
}));
vi.mock("../db/repos/catalog.repo", () => ({
  findVariantById: vi.fn(),
  findProductById: vi.fn(),
  listImagesForProducts: vi.fn(),
}));
vi.mock("./catalog.service", () => ({
  getProductOrThrow: vi.fn(),
  getVariantOrThrow: vi.fn(),
}));

import * as cartRepo from "../db/repos/cart.repo";
import * as catalogRepo from "../db/repos/catalog.repo";
import * as catalogService from "./catalog.service";
import { getCart, addToCart } from "./cart.service";

function fakeCartItem(overrides: Partial<{ id: string; userId: string; variantId: string; quantity: number }> = {}) {
  return { id: "item-1", userId: "user-1", variantId: "variant-1", quantity: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...overrides };
}
function fakeVariant(overrides: Partial<{ id: string; productId: string; stockQty: number }> = {}) {
  return { id: "variant-1", productId: "product-1", size: "M", color: "Black", stockQty: 10, sku: null, ...overrides };
}
function fakeProduct(overrides: Partial<{ id: string; active: boolean; priceCents: number }> = {}) {
  return { id: "product-1", slug: "test-product", name: "Test Product", priceCents: 5000, active: true, ...overrides };
}

beforeEach(() => {
  vi.mocked(cartRepo.listCartItems).mockReset();
  vi.mocked(cartRepo.upsertCartItem).mockReset();
  vi.mocked(catalogRepo.findVariantById).mockReset();
  vi.mocked(catalogRepo.findProductById).mockReset();
  vi.mocked(catalogRepo.listImagesForProducts).mockReset().mockResolvedValue(new Map());
  vi.mocked(catalogService.getProductOrThrow).mockReset();
  vi.mocked(catalogService.getVariantOrThrow).mockReset();
});

describe("getCart — availability flag", () => {
  it("marks a line available when the product is active and the variant is in stock", async () => {
    vi.mocked(cartRepo.listCartItems).mockResolvedValue([fakeCartItem()] as any);
    vi.mocked(catalogRepo.findVariantById).mockResolvedValue(fakeVariant({ stockQty: 5 }) as any);
    vi.mocked(catalogRepo.findProductById).mockResolvedValue(fakeProduct({ active: true }) as any);

    const result = await getCart("user-1");

    expect(result.items[0].available).toBe(true);
    expect(result.subtotalCents).toBe(10000); // 5000 * qty 2 — counted normally
  });

  it("marks a line unavailable when the product has gone inactive, and excludes it from the subtotal", async () => {
    vi.mocked(cartRepo.listCartItems).mockResolvedValue([fakeCartItem()] as any);
    vi.mocked(catalogRepo.findVariantById).mockResolvedValue(fakeVariant({ stockQty: 5 }) as any);
    vi.mocked(catalogRepo.findProductById).mockResolvedValue(fakeProduct({ active: false }) as any);

    const result = await getCart("user-1");

    expect(result.items[0].available).toBe(false);
    expect(result.subtotalCents).toBe(0); // the only line is unavailable — not counted
  });

  it("marks a line unavailable when the variant is out of stock, even if the product itself is active", async () => {
    vi.mocked(cartRepo.listCartItems).mockResolvedValue([fakeCartItem()] as any);
    vi.mocked(catalogRepo.findVariantById).mockResolvedValue(fakeVariant({ stockQty: 0 }) as any);
    vi.mocked(catalogRepo.findProductById).mockResolvedValue(fakeProduct({ active: true }) as any);

    const result = await getCart("user-1");

    expect(result.items[0].available).toBe(false);
    expect(result.subtotalCents).toBe(0);
  });

  it("computes the subtotal from only the available lines when the cart has a mix of available and unavailable items", async () => {
    vi.mocked(cartRepo.listCartItems).mockResolvedValue([
      fakeCartItem({ id: "item-1", variantId: "variant-1", quantity: 1 }),
      fakeCartItem({ id: "item-2", variantId: "variant-2", quantity: 1 }),
    ] as any);
    vi.mocked(catalogRepo.findVariantById).mockImplementation(async (id: string) =>
      (id === "variant-1" ? fakeVariant({ id: "variant-1", productId: "product-1", stockQty: 5 }) : fakeVariant({ id: "variant-2", productId: "product-2", stockQty: 5 })) as any
    );
    vi.mocked(catalogRepo.findProductById).mockImplementation(async (id: string) =>
      (id === "product-1" ? fakeProduct({ id: "product-1", active: true, priceCents: 3000 }) : fakeProduct({ id: "product-2", active: false, priceCents: 9000 })) as any
    );

    const result = await getCart("user-1");

    expect(result.subtotalCents).toBe(3000); // only the active product's line counts
  });
});

describe("addToCart — validation, never trusting a client-supplied price", () => {
  it("has no price parameter at all — price can only ever come from the product record looked up server-side", () => {
    // Structural proof, not a runtime one: addToCart's signature is
    // (userId, variantId, quantity) — there is no price argument to trust
    // or distrust in the first place.
    expect(addToCart.length).toBe(3);
  });

  it("rejects a quantity outside 1-20 before ever looking up the variant", async () => {
    await expect(addToCart("user-1", "variant-1", 0)).rejects.toThrow();
    await expect(addToCart("user-1", "variant-1", 21)).rejects.toThrow();
    expect(catalogService.getVariantOrThrow).not.toHaveBeenCalled();
  });

  it("rejects adding a variant whose product is inactive", async () => {
    vi.mocked(catalogService.getVariantOrThrow).mockResolvedValue(fakeVariant({ stockQty: 5 }) as any);
    vi.mocked(catalogService.getProductOrThrow).mockRejectedValue(new Error("Product not found."));

    await expect(addToCart("user-1", "variant-1", 1)).rejects.toThrow();
    expect(cartRepo.upsertCartItem).not.toHaveBeenCalled();
  });

  it("rejects adding an out-of-stock variant", async () => {
    vi.mocked(catalogService.getVariantOrThrow).mockResolvedValue(fakeVariant({ stockQty: 0 }) as any);
    vi.mocked(catalogService.getProductOrThrow).mockResolvedValue(fakeProduct() as any);

    await expect(addToCart("user-1", "variant-1", 1)).rejects.toThrow(/out of stock/);
    expect(cartRepo.upsertCartItem).not.toHaveBeenCalled();
  });
});
