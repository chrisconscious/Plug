// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ShopByBrands } from "./brand-carousel";
import * as api from "../lib/api";
import type { Brand } from "../lib/api";

/**
 * The "Shop by Brand" carousel is strictly API-driven: exactly the ACTIVE
 * brands returned by the backend, in the admin's display order, using the
 * uploaded logo / campaign-image URLs (with the brand NAME as the wordmark
 * fallback when there is no logo). The tests below control only what the
 * mocked API resolves with and assert the section mirrors it exactly — a
 * regression guard against any hardcoded brand list (the anti-pattern the
 * original logo-strip removal eliminated) or a fixed set of cards.
 */

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof api>("../lib/api");
  return { ...actual, listBrands: vi.fn(), getBrandSectionSettings: vi.fn() };
});

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useInView: () => true };
});

// Force the rail to "fit exactly 2 cards": gating is then observable in jsdom
// (which has no ResizeObserver, so the real hook stays at Infinity).

const mockedListBrands = vi.mocked(api.listBrands);
const mockedSettings = vi.mocked(api.getBrandSectionSettings);

const LOGO = {
  id: "l1",
  brandId: "b1",
  storageKey: "brands/logo-acme",
  url: "/uploads/brands/logo-acme",
  contentType: "image/png",
  sizeBytes: 1024,
  width: 736,
  height: 917,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const CAMPAIGN = {
  id: "c1",
  brandId: "b1",
  storageKey: "brands/campaign-acme",
  url: "/uploads/brands/campaign-acme",
  contentType: "image/jpeg",
  sizeBytes: 2048,
  width: 736,
  height: 917,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

let seed = 0;

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  seed += 1;
  return {
    id: `b${seed}`,
    slug: "acme",
    name: "Acme",
    active: true,
    displayOrder: 0,
    ...overrides,
  };
}

function renderBrands() {
  return render(
    <MemoryRouter>
      <ShopByBrands />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockedListBrands.mockReset();
  mockedSettings.mockReset();
  mockedSettings.mockResolvedValue({ speed: "medium" });
});

afterEach(() => {
  cleanup();
});

describe("ShopByBrands — content is entirely API-driven", () => {
  it("renders one card per active brand with the right link and label, in admin order", async () => {
    mockedListBrands.mockResolvedValue({
      brands: [
        makeBrand({ id: "b2", slug: "zara", name: "Zara", displayOrder: 1 }),
        makeBrand({ id: "b1", slug: "acme", name: "Acme", displayOrder: 0 }),
        makeBrand({ id: "b3", slug: "theta", name: "Theta", displayOrder: 1 }),
        makeBrand({ id: "b4", slug: "amber", name: "Amber", displayOrder: 2 }),
      ],
    });
    renderBrands();

    const acme = await screen.findByRole("link", { name: "Shop Acme" });
    expect(acme.getAttribute("href")).toBe("/brands/acme");
    expect(screen.getByRole("link", { name: "Shop Zara" }).getAttribute("href")).toBe("/brands/zara");
    expect(screen.getByRole("link", { name: "Shop Theta" }).getAttribute("href")).toBe("/brands/theta");
    expect(screen.getByRole("link", { name: "Shop Amber" }).getAttribute("href")).toBe("/brands/amber");

    // displayOrder 0 first, then name-alphabetical within the same order.
    // (The "/^Shop /" name filter excludes the desktop EXPLORE ALL link.)
    const order = screen.getAllByRole("link", { name: /^Shop / }).map((el) => el.getAttribute("aria-label"));
    expect(order).toEqual(["Shop Acme", "Shop Theta", "Shop Zara", "Shop Amber"]);
  });

  it("filters INACTIVE brands out and never renders a hardcoded list", async () => {
    // Deliberately fictional labels — they exist ONLY in this mock. If the
    // component ever hardcodes brand data, these tests would fail.
    mockedListBrands.mockResolvedValue({
      brands: [
        makeBrand({ slug: "active-one", name: "Active One", active: true }),
        makeBrand({ slug: "hidden-brand", name: "Hidden Brand", active: false }),
        makeBrand({ slug: "active-two", name: "Active Two", active: true }),
      ],
    });
    renderBrands();

    expect(await screen.findByRole("link", { name: "Shop Active One" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Shop Active Two" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Shop Hidden Brand" })).not.toBeInTheDocument();
    // No stock brand strip names ever appear.
    expect(screen.queryByText(/Gucci|Nike|Zara|H&M|adidas/i)).not.toBeInTheDocument();
  });

  it("uses the API-provided campaign image URL and renders the white-silhouette photo mark", async () => {
    mockedListBrands.mockResolvedValue({
      brands: [makeBrand({ name: "Photo House", campaignImage: CAMPAIGN })],
    });
    renderBrands();

    const card = await screen.findByRole("link", { name: "Shop Photo House" });
    const photo = card.querySelector<HTMLImageElement>("img")!;
    expect(photo.src).toContain("campaign-acme");
    expect(photo.getAttribute("loading")).toBe("lazy");
    expect(card.querySelector(".brandCardMark--photo")).toBeInTheDocument();
  });

  it("renders a LIGHT (white) logo as a dark silhouette on the plain tile, and leaves dark logos untouched", async () => {
    mockedListBrands.mockResolvedValue({
      brands: [
        makeBrand({ id: "w", name: "White Mark", logo: { ...LOGO, tone: "light" } }),
        makeBrand({ id: "d", name: "Dark Mark", logo: { ...LOGO, tone: "dark" } }),
        makeBrand({ id: "p", name: "Photo White", logo: { ...LOGO, tone: "light" }, campaignImage: CAMPAIGN }),
      ],
    });
    renderBrands();
    const white = (await screen.findByRole("link", { name: "Shop White Mark" })).querySelector(".brandCardMark img")!;
    const dark = screen.getByRole("link", { name: "Shop Dark Mark" }).querySelector(".brandCardMark img")!;
    const onPhoto = screen.getByRole("link", { name: "Shop Photo White" }).querySelector(".brandCardMark img")!;
    expect(white.className).toContain("brandMarkImg--lightOnLight");
    expect(dark.className).not.toContain("brandMarkImg--lightOnLight");
    expect(onPhoto.className).toContain("brandMarkImg--onPhoto");
  });

  it("falls back to the brand name when the logo image fails to load (broken URL is not hidden silently)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedListBrands.mockResolvedValue({ brands: [makeBrand({ id: "x", name: "Broken House", logo: LOGO })] });
    renderBrands();
    const card = await screen.findByRole("link", { name: "Shop Broken House" });
    fireEvent.error(card.querySelector(".brandCardMark img")!);
    await waitFor(() => expect(card.querySelector(".brandWord")).toHaveTextContent("Broken House"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Broken House"));
    warn.mockRestore();
  });

  it("uses the API-provided logo URL as the mark and falls back to a NAME wordmark when there is no logo", async () => {
    mockedListBrands.mockResolvedValue({
      brands: [
        makeBrand({ id: "b1", name: "Marked House", logo: LOGO }),
        makeBrand({ id: "b2", name: "Wordmark House" }),
      ],
    });
    renderBrands();

    const marked = await screen.findByRole("link", { name: "Shop Marked House" });
    expect(marked.querySelector<HTMLImageElement>(".brandCardMark img")!.src).toContain("logo-acme");
    // No campaign image -> the plain (black wordmark) variant is used.
    expect(marked.querySelector(".brandCardMark--plain")).toBeInTheDocument();

    const word = screen.getByRole("link", { name: "Shop Wordmark House" });
    expect(word.querySelector(".brandWord")).toHaveTextContent("Wordmark House");
  });
});

describe("ShopByBrands — loading, empty, and error states", () => {
  it("shows skeleton placeholder cards before the API resolves", async () => {
    let resolvePromise: (v: { brands: Brand[] }) => void;
    mockedListBrands.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    const { container } = renderBrands();
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    resolvePromise!({ brands: [makeBrand()] });
    await waitFor(() => expect(container.querySelectorAll(".animate-pulse").length).toBe(0));
  });

  it("renders nothing when the API returns zero active brands", async () => {
    mockedListBrands.mockResolvedValue({ brands: [] });
    const { container } = renderBrands();
    await waitFor(() => expect(mockedListBrands).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});

describe("ShopByBrands — EXPLORE ALL", () => {
  it("shows EXPLORE ALL to the All Brands page even when a single brand exists", async () => {
    mockedListBrands.mockResolvedValue({ brands: [makeBrand({ slug: "solo", name: "Solo House" })] });
    renderBrands();
    await screen.findByRole("link", { name: "Shop Solo House" });
    for (const link of screen.getAllByRole("link", { name: "EXPLORE ALL" })) expect(link.getAttribute("href")).toBe("/brands");
  });

  it("shows EXPLORE ALL (desktop + mobile placement) pointing at /brands with many brands", async () => {
    mockedListBrands.mockResolvedValue({
      brands: Array.from({ length: 5 }).map((_, i) =>
        makeBrand({ slug: `brand-${i}`, name: `Brand ${i}`, displayOrder: i })
      ),
    });
    renderBrands();
    await screen.findAllByRole("link", { name: /^Shop Brand \d/ });
    const explore = screen.getAllByRole("link", { name: "EXPLORE ALL" });
    expect(explore.length).toBeGreaterThan(0);
    for (const link of explore) expect(link.getAttribute("href")).toBe("/brands");
  });
});