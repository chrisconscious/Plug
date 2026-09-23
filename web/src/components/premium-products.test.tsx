// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PremiumProducts } from "./premium-products";
import * as api from "../lib/api";
import type { Product, ProductPage } from "../lib/api";

/**
 * "VIEW ALL" must be gated on real catalogue size: it only appears when this
 * shelf really is the latest 6 of a larger drop (pagination total > 6). When
 * the total equals what's shown, the link disappears — its destination would
 * only show the same products again. jsdom has no ResizeObserver, so the
 * "how many fit on screen" measurement stays at Infinity and the gating
 * decision is driven purely by the pagination total, which is exactly the
 * point of these tests.
 */

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof api>("../lib/api");
  return { ...actual, listProducts: vi.fn() };
});

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useInView: () => true };
});

const mockedListProducts = vi.mocked(api.listProducts);

let seed = 0;

function makeProduct(overrides: Partial<Product> = {}): Product {
  seed += 1;
  return {
    id: `p${seed}`,
    slug: `product-${seed}`,
    name: `Test Product ${seed}`,
    brand: null,
    category: null,
    priceCents: 100000 + seed,
    compareAtPriceCents: null,
    onSale: false,
    discountPercent: null,
    gender: null,
    images: [],
    active: true,
    variants: [],
    ...overrides,
  };
}

function page(list: Product[], total: number): ProductPage {
  return {
    items: list,
    pagination: { page: 1, pageSize: 4, total },
    facets: {
      brands: [],
      categories: [],
      sizes: [],
      colors: [],
      genders: [],
      collections: [],
      availability: { inStock: 0, outOfStock: 0 },
      price: { min: 0, max: 0, p25: 0, p50: 0, p75: 0 },
    },
  };
}

function renderPremiums() {
  return render(
    <MemoryRouter>
      <PremiumProducts />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockedListProducts.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PremiumProducts — VIEW ALL gating on real catalogue size", () => {
  it("shows VIEW ALL when the shelf is the latest 6 of a larger drop (total > 6)", async () => {
    mockedListProducts.mockResolvedValue(page(Array.from({ length: 6 }, makeProduct), 8));
    renderPremiums();

    await screen.findByText("The latest drop");
    await waitFor(() =>
      expect(mockedListProducts).toHaveBeenCalledWith({ collection: "premium", page: 1, pageSize: 6 })
    );
    // The smartphone grid is 2 columns x 3 rows of the latest drop.
    expect(await screen.findAllByRole("link", { name: /Test Product \d/ })).toHaveLength(6);

    const explore = screen.getAllByRole("link", { name: "VIEW ALL" });
    expect(explore.length).toBeGreaterThan(0);
    for (const link of explore) expect(link.getAttribute("href")).toBe("/shop?collection=premium");
  });

  it("hides VIEW ALL when the grid already shows the whole drop (total === 4)", async () => {
    mockedListProducts.mockResolvedValue(page(Array.from({ length: 4 }, makeProduct), 4));
    renderPremiums();

    await screen.findAllByRole("link", { name: /Test Product \d/ });
    expect(screen.queryByRole("link", { name: "VIEW ALL" })).not.toBeInTheDocument();
  });

  it("hides VIEW ALL when the drop is empty", async () => {
    mockedListProducts.mockResolvedValue(page([], 0));
    renderPremiums();

    await waitFor(() => expect(mockedListProducts).toHaveBeenCalled());
    expect(await screen.findByText(/No featured products/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "VIEW ALL" })).not.toBeInTheDocument();
  });
});