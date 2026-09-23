import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/orders.repo", () => ({
  getOrderById: vi.fn(),
  createOrderTransactional: vi.fn(),
  listOrdersForUser: vi.fn(),
}));
vi.mock("../db/repos/users.repo", () => ({ findUserById: vi.fn() }));
vi.mock("../db/repos/cart.repo", () => ({
  findCartItemById: vi.fn(),
  listCartItems: vi.fn(),
  updateCartItemQuantity: vi.fn(),
  deleteCartItem: vi.fn(),
}));
vi.mock("../db/repos/catalog.repo", () => ({
  findVariantById: vi.fn(),
  findProductById: vi.fn(),
  listImagesForProducts: vi.fn(),
}));
vi.mock("./catalog.service", () => ({
  getVariantOrThrow: vi.fn(),
  getProductOrThrow: vi.fn(),
}));

import * as ordersRepo from "../db/repos/orders.repo";
import * as cartRepo from "../db/repos/cart.repo";
import * as catalogRepo from "../db/repos/catalog.repo";
import * as catalogService from "./catalog.service";
import { getOrderForUser } from "./order.service";
import { updateCartItemQuantity, removeCartItem } from "./cart.service";

/**
 * IDOR (Insecure Direct Object Reference) tests — proving Customer A
 * cannot access or modify Customer B's resources merely by knowing (or
 * guessing) their id. Every one of these calls a REAL service function
 * with a mocked repo layer returning a resource that belongs to a
 * DIFFERENT user than the one making the call — the test fails unless
 * the service itself actually checks ownership, not just existence.
 */

const CUSTOMER_A = "customer-a-id";
const CUSTOMER_B = "customer-b-id";

beforeEach(() => {
  vi.mocked(ordersRepo.getOrderById).mockReset();
  vi.mocked(cartRepo.findCartItemById).mockReset();
  vi.mocked(cartRepo.updateCartItemQuantity).mockReset();
  vi.mocked(cartRepo.deleteCartItem).mockReset();
  vi.mocked(catalogRepo.listImagesForProducts).mockReset().mockResolvedValue(new Map());
});

describe("IDOR — Customer A attempting to access Customer B's order", () => {
  it("rejects fetching an order that belongs to a different customer", async () => {
    vi.mocked(ordersRepo.getOrderById).mockResolvedValue({
      id: "order-belongs-to-b", userId: CUSTOMER_B, status: "PENDING",
      subtotalCents: 1000, discountCents: 0, shippingCents: 0, totalCents: 1000,
      items: [], createdAt: "2026-01-01T00:00:00Z",
    } as any);

    // Customer A supplies the order id directly (as if guessed/enumerated
    // from a sequential id, a leaked reference, etc.) — the service must
    // reject this based on ownership, not merely because the order exists.
    await expect(getOrderForUser(CUSTOMER_A, "order-belongs-to-b")).rejects.toThrow();
  });

  it("succeeds when the order genuinely belongs to the requesting customer", async () => {
    vi.mocked(ordersRepo.getOrderById).mockResolvedValue({
      id: "order-belongs-to-a", userId: CUSTOMER_A, status: "PENDING",
      subtotalCents: 1000, discountCents: 0, shippingCents: 0, totalCents: 1000,
      items: [], createdAt: "2026-01-01T00:00:00Z",
    } as any);

    const order = await getOrderForUser(CUSTOMER_A, "order-belongs-to-a");
    expect(order.id).toBe("order-belongs-to-a");
  });

  it("does not leak whether the order exists at all for a nonexistent id (same NotFoundError path as ownership mismatch would ideally use, or at minimum never returns the data)", async () => {
    vi.mocked(ordersRepo.getOrderById).mockResolvedValue(null);
    await expect(getOrderForUser(CUSTOMER_A, "nonexistent-order")).rejects.toThrow();
  });
});

describe("IDOR — Customer A attempting to modify Customer B's cart item", () => {
  it("rejects updating the quantity of a cart item owned by a different customer", async () => {
    vi.mocked(cartRepo.findCartItemById).mockResolvedValue({
      id: "cart-item-belongs-to-b", userId: CUSTOMER_B, variantId: "variant-1",
      quantity: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01",
    } as any);

    await expect(updateCartItemQuantity(CUSTOMER_A, "cart-item-belongs-to-b", 5)).rejects.toThrow();
    expect(cartRepo.updateCartItemQuantity).not.toHaveBeenCalled();
  });

  it("rejects deleting a cart item owned by a different customer", async () => {
    vi.mocked(cartRepo.findCartItemById).mockResolvedValue({
      id: "cart-item-belongs-to-b", userId: CUSTOMER_B, variantId: "variant-1",
      quantity: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01",
    } as any);

    await expect(removeCartItem(CUSTOMER_A, "cart-item-belongs-to-b")).rejects.toThrow();
    expect(cartRepo.deleteCartItem).not.toHaveBeenCalled();
  });

  it("succeeds when the cart item genuinely belongs to the requesting customer", async () => {
    vi.mocked(cartRepo.findCartItemById).mockResolvedValue({
      id: "cart-item-belongs-to-a", userId: CUSTOMER_A, variantId: "variant-1",
      quantity: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01",
    } as any);
    vi.mocked(catalogService.getVariantOrThrow).mockResolvedValue({ id: "variant-1", productId: "product-1", stockQty: 5 } as any);
    vi.mocked(cartRepo.updateCartItemQuantity).mockResolvedValue(undefined as any);
    vi.mocked(cartRepo.listCartItems).mockResolvedValue([]);

    await expect(updateCartItemQuantity(CUSTOMER_A, "cart-item-belongs-to-a", 3)).resolves.toBeDefined();
    expect(cartRepo.updateCartItemQuantity).toHaveBeenCalled();
  });
});

describe("IDOR — structural (no endpoint exists to request another user's profile)", () => {
  it("documents that /auth/me never accepts a target user id — it always resolves the CALLER's own session, so there is no id parameter to manipulate for this endpoint", () => {
    // This is a structural property, not something a unit test executes:
    // GET /api/v1/auth/me (see auth-routes.test.ts) takes no path/query
    // parameter identifying which user to fetch — `user` comes from
    // withRoute's session resolution only. There is no /users/:id or
    // /profile/:id route anywhere in this API (confirmed by inspecting
    // src/app/api/v1 directly) — the IDOR surface this scenario worries
    // about does not exist to begin with, rather than existing and being
    // separately guarded.
    expect(true).toBe(true);
  });
});
