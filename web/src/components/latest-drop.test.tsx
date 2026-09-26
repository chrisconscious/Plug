// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LatestDrop, LATEST_DROP_SIZE } from "./latest-drop";
import * as api from "../lib/api";
import type { Product, ProductPage } from "../lib/api";

/**
 * The Latest Drop is a rolling window of the newest PUBLISHED products: it must
 * ask the API for `sort=newest` with no tag/category/brand filter, render the
 * products in exactly the order the server returns them, and only offer
 * "VIEW ALL" when more products exist than the window shows.
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

function renderLatestDrop() {
  return render(
    <MemoryRouter>
      <LatestDrop />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockedListProducts.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("LatestDrop — rolling newest-published window", () => {
  it("requests the newest live products with no tag/category/brand filter", async () => {
    mockedListProducts.mockResolvedValue(page(Array.from({ length: 3 }, () => makeProduct()), 3));
    renderLatestDrop();
    await waitFor(() =>
      expect(mockedListProducts).toHaveBeenCalledWith({ sort: "newest", page: 1, pageSize: LATEST_DROP_SIZE })
    );
    const args = mockedListProducts.mock.calls[0]![0]!;
    expect(args).not.toHaveProperty("collection");
    expect(args).not.toHaveProperty("category");
    expect(args).not.toHaveProperty("brand");
  });

  it("renders products in server order (newest first) — e.g. E, D, C, B, A", async () => {
    const names = ["E", "D", "C", "B", "A"];
    mockedListProducts.mockResolvedValue(page(names.map((n) => makeProduct({ name: `Drop ${n}` })), 5));
    renderLatestDrop();
    const links = await screen.findAllByRole("link", { name: /^Drop [A-E]$/ });
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(names.map((n) => `Drop ${n}`));
  });

  it("shows VIEW ALL to the newest-first shop when more products exist than the window", async () => {
    mockedListProducts.mockResolvedValue(page(Array.from({ length: LATEST_DROP_SIZE }, () => makeProduct()), LATEST_DROP_SIZE + 2));
    renderLatestDrop();
    expect(await screen.findAllByRole("link", { name: /Test Product \d/ })).toHaveLength(LATEST_DROP_SIZE);
    const explore = screen.getAllByRole("link", { name: "VIEW ALL" });
    expect(explore.length).toBeGreaterThan(0);
    for (const link of explore) expect(link.getAttribute("href")).toBe("/shop?sort=newest");
  });

  it("hides VIEW ALL when the window already shows everything", async () => {
    mockedListProducts.mockResolvedValue(page(Array.from({ length: 4 }, () => makeProduct()), 4));
    renderLatestDrop();
    await screen.findAllByRole("link", { name: /Test Product \d/ });
    expect(screen.queryByRole("link", { name: "VIEW ALL" })).not.toBeInTheDocument();
  });

  it("shows a calm empty state when nothing is published yet", async () => {
    mockedListProducts.mockResolvedValue(page([], 0));
    renderLatestDrop();
    expect(await screen.findByText(/New pieces are on their way/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "VIEW ALL" })).not.toBeInTheDocument();
  });

  it("marks a product SOLD OUT when none of its variants is in stock", async () => {
    mockedListProducts.mockResolvedValue(
      page(
        [
          makeProduct({ name: "Gone", soldOut: true, variants: [{ id: "v1", size: "M", color: "Black", inStock: false, lowStock: false }] }),
          makeProduct({ name: "Here", soldOut: false, variants: [{ id: "v2", size: "M", color: "Black", inStock: true, lowStock: false }] }),
        ],
        2
      )
    );
    renderLatestDrop();
    const gone = await screen.findByRole("link", { name: "Gone" });
    const here = screen.getByRole("link", { name: "Here" });
    expect(gone.textContent).toContain("SOLD OUT");
    expect(here.textContent).not.toContain("SOLD OUT");
  });
});
