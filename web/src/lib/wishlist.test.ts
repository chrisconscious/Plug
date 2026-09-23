// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof api>("./api");
  return { ...actual, listWishlist: vi.fn(), addToWishlistServer: vi.fn(), removeFromWishlistServer: vi.fn() };
});

const mockedList = vi.mocked(api.listWishlist);
const mockedAdd = vi.mocked(api.addToWishlistServer);
const mockedRemove = vi.mocked(api.removeFromWishlistServer);

function fakeProduct(overrides: Partial<api.Product> = {}): api.Product {
  return {
    id: "p1", slug: "test-product", name: "Test Product", brand: null, category: null,
    priceCents: 1000, onSale: false, discountPercent: null, images: [], active: true, variants: [],
    ...overrides,
  } as api.Product;
}

beforeEach(async () => {
  localStorage.clear();
  mockedList.mockReset();
  mockedAdd.mockReset();
  mockedRemove.mockReset();
  // Fresh module instance per test — the module has top-level mutable
  // state (cache/mode) that would otherwise leak between test cases.
  vi.resetModules();
});

describe("wishlist — guest mode (localStorage)", () => {
  it("starts empty for a fresh guest", async () => {
    const { getWishlist } = await import("./wishlist");
    expect(getWishlist()).toEqual([]);
  });

  it("toggling a product on adds it, and persists to localStorage", async () => {
    const { toggleWishlist, isWishlisted } = await import("./wishlist");
    const product = fakeProduct();
    const result = await toggleWishlist(product);
    expect(result).toBe(true);
    expect(isWishlisted("test-product")).toBe(true);
    expect(JSON.parse(localStorage.getItem("vv_wishlist_products3")!)).toHaveLength(1);
  });

  it("toggling the same product again removes it", async () => {
    const { toggleWishlist, isWishlisted } = await import("./wishlist");
    const product = fakeProduct();
    await toggleWishlist(product);
    const result = await toggleWishlist(product);
    expect(result).toBe(false);
    expect(isWishlisted("test-product")).toBe(false);
  });

  it("never calls the server API while in guest mode", async () => {
    const { toggleWishlist } = await import("./wishlist");
    await toggleWishlist(fakeProduct());
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("notifies subscribers (the cross-component/cross-tab-in-the-same-window update mechanism) when the wishlist changes", async () => {
    const { toggleWishlist, onWishlistChange } = await import("./wishlist");
    const listener = vi.fn();
    const unsubscribe = onWishlistChange(listener);
    await toggleWishlist(fakeProduct());
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe("wishlist — authenticated mode (server-backed)", () => {
  it("hydrates from the server when switching to authenticated with an empty guest cart", async () => {
    const { setWishlistAuthMode, getWishlist } = await import("./wishlist");
    mockedList.mockResolvedValue({ wishlist: [{ id: "w1", product: fakeProduct({ slug: "server-item" }) }] });

    await setWishlistAuthMode(true);

    expect(getWishlist()).toHaveLength(1);
    expect(getWishlist()[0].slug).toBe("server-item");
    expect(mockedAdd).not.toHaveBeenCalled(); // nothing to merge — guest list was empty
  });

  it("toggling on adds via the server API and reflects the server's returned wishlist", async () => {
    const { setWishlistAuthMode, toggleWishlist, isWishlisted } = await import("./wishlist");
    mockedList.mockResolvedValue({ wishlist: [] });
    await setWishlistAuthMode(true);

    const product = fakeProduct();
    mockedAdd.mockResolvedValue({ wishlist: [{ id: "w1", product }] });
    await toggleWishlist(product);

    expect(mockedAdd).toHaveBeenCalledWith("p1");
    expect(isWishlisted("test-product")).toBe(true);
  });

  it("toggling off removes via the server API", async () => {
    const { setWishlistAuthMode, toggleWishlist, isWishlisted } = await import("./wishlist");
    const product = fakeProduct();
    mockedList.mockResolvedValue({ wishlist: [{ id: "w1", product }] });
    await setWishlistAuthMode(true);

    mockedRemove.mockResolvedValue({ wishlist: [] });
    await toggleWishlist(product);

    expect(mockedRemove).toHaveBeenCalledWith("p1");
    expect(isWishlisted("test-product")).toBe(false);
  });

  it("reverts the optimistic update if the server call fails", async () => {
    const { setWishlistAuthMode, toggleWishlist, isWishlisted } = await import("./wishlist");
    mockedList.mockResolvedValue({ wishlist: [] });
    await setWishlistAuthMode(true);

    mockedAdd.mockRejectedValue(new Error("network error"));
    const product = fakeProduct();
    await toggleWishlist(product);

    // Optimistic add happened, then reverted on failure.
    expect(isWishlisted("test-product")).toBe(false);
  });
});

describe("wishlist — guest-to-user merge on login", () => {
  it("adds every guest-wishlisted product to the server, then clears guest storage", async () => {
    const { toggleWishlist, setWishlistAuthMode, getWishlist } = await import("./wishlist");
    // Build up a guest wishlist first.
    await toggleWishlist(fakeProduct({ id: "g1", slug: "guest-item-1" }));
    await toggleWishlist(fakeProduct({ id: "g2", slug: "guest-item-2" }));
    expect(localStorage.getItem("vv_wishlist_products3")).not.toBeNull();

    mockedAdd.mockResolvedValue({ wishlist: [] }); // return value unused by the merge step itself
    mockedList.mockResolvedValue({
      wishlist: [
        { id: "w1", product: fakeProduct({ id: "g1", slug: "guest-item-1" }) },
        { id: "w2", product: fakeProduct({ id: "g2", slug: "guest-item-2" }) },
      ],
    });

    await setWishlistAuthMode(true);

    expect(mockedAdd).toHaveBeenCalledWith("g1");
    expect(mockedAdd).toHaveBeenCalledWith("g2");
    expect(mockedAdd).toHaveBeenCalledTimes(2);
    // Guest storage cleared only after the merge was attempted.
    expect(localStorage.getItem("vv_wishlist_products3")).toBeNull();
    // Post-merge state reflects the server (source of truth), not the raw guest list.
    expect(getWishlist()).toHaveLength(2);
  });

  it("does not call the server at all if the guest wishlist was empty", async () => {
    const { setWishlistAuthMode } = await import("./wishlist");
    mockedList.mockResolvedValue({ wishlist: [] });
    await setWishlistAuthMode(true);
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("a duplicate item (already on the server) does not break the merge — the failure is contained per-item", async () => {
    const { toggleWishlist, setWishlistAuthMode } = await import("./wishlist");
    await toggleWishlist(fakeProduct({ id: "g1", slug: "guest-item-1" }));

    mockedAdd.mockRejectedValue(new api.ApiError(409, "Already in wishlist."));
    mockedList.mockResolvedValue({ wishlist: [{ id: "w1", product: fakeProduct({ id: "g1", slug: "guest-item-1" }) }] });

    await expect(import("./wishlist").then((m) => m.setWishlistAuthMode(true))).resolves.not.toThrow();
  });
});

describe("wishlist — logout reverts to guest mode", () => {
  it("switches back to reading localStorage after logout", async () => {
    const { setWishlistAuthMode, getWishlist, toggleWishlist } = await import("./wishlist");
    mockedList.mockResolvedValue({ wishlist: [{ id: "w1", product: fakeProduct({ slug: "server-item" }) }] });
    await setWishlistAuthMode(true);
    expect(getWishlist()).toHaveLength(1);

    await setWishlistAuthMode(false);
    // Back to guest storage, which is empty (nothing was ever added as a guest in this test).
    expect(getWishlist()).toEqual([]);

    // Confirm guest mode is REALLY active (not just an empty server cache) —
    // toggling now must not call the server.
    await toggleWishlist(fakeProduct());
    expect(mockedAdd).not.toHaveBeenCalled();
  });
});
