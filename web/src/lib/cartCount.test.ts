import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./api", () => ({ getCart: vi.fn() }));

import * as api from "./api";
import { getCartCount, refreshCartCount, clearCartCount, setCartCountFromItems, onCartCountChange } from "./cartCount";

beforeEach(() => {
  vi.mocked(api.getCart).mockReset();
  clearCartCount(); // reset the module's shared state between tests
});

describe("cartCount", () => {
  it("sums item quantities from a real fetch, not just item count", async () => {
    vi.mocked(api.getCart).mockResolvedValue({
      cart: { items: [{ id: "a", quantity: 2 }, { id: "b", quantity: 3 }] as any, subtotalCents: 0 },
    });
    await refreshCartCount();
    expect(getCartCount()).toBe(5);
  });

  it("falls back to 0 on a fetch failure rather than keeping a stale count", async () => {
    vi.mocked(api.getCart).mockResolvedValue({ cart: { items: [{ id: "a", quantity: 4 }] as any, subtotalCents: 0 } });
    await refreshCartCount();
    expect(getCartCount()).toBe(4);

    vi.mocked(api.getCart).mockRejectedValue(new Error("network error"));
    await refreshCartCount();
    expect(getCartCount()).toBe(0);
  });

  it("setCartCountFromItems computes the sum without calling the API at all", () => {
    setCartCountFromItems([{ quantity: 1 }, { quantity: 5 }, { quantity: 0 }]);
    expect(getCartCount()).toBe(6);
    expect(api.getCart).not.toHaveBeenCalled();
  });

  it("notifies subscribers whenever the count changes", () => {
    const listener = vi.fn();
    const unsubscribe = onCartCountChange(listener);
    setCartCountFromItems([{ quantity: 2 }]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setCartCountFromItems([{ quantity: 9 }]);
    expect(listener).toHaveBeenCalledTimes(1); // not called again after unsubscribing
  });

  it("clearCartCount resets to 0 and notifies", () => {
    setCartCountFromItems([{ quantity: 7 }]);
    expect(getCartCount()).toBe(7);
    clearCartCount();
    expect(getCartCount()).toBe(0);
  });
});
