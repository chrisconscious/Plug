// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HeroCarousel } from "./hero-carousel";
import * as api from "../lib/api";
import type { PublicHeroSlide } from "../lib/api";

/**
 * This suite exists to prove one specific architectural claim: the homepage
 * hero has NO hardcoded business content. Every test below controls only
 * what the mocked API call resolves with — never anything inside
 * hero-carousel.tsx itself — and asserts the rendered page reflects exactly
 * that data. If someone reintroduces a hardcoded fallback headline/image
 * (the anti-pattern this whole task was about removing — see the removed
 * hero-grid.tsx and its hardcoded upload UUIDs), the "different API data ->
 * different rendered output, old data never leaks through" tests below
 * would catch it.
 */

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof api>("../lib/api");
  return { ...actual, listHeroSlides: vi.fn() };
});

const mockedListHeroSlides = vi.mocked(api.listHeroSlides);

function makeSlide(overrides: Partial<PublicHeroSlide> = {}): PublicHeroSlide {
  return {
    id: "slide-1",
    campaignLabel: "TEST CAMPAIGN",
    headline: "Default Test Headline",
    description: "Default test description.",
    ctaText: "Shop Now",
    ctaUrl: "/shop",
    badgeText: null,
    editorialText: null,
    heroType: "promotional",
    imageUrl: "/uploads/hero/test-image.jpg",
    ...overrides,
  };
}

function renderHero() {
  return render(
    <MemoryRouter>
      <HeroCarousel />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockedListHeroSlides.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("HeroCarousel — content is entirely API-driven", () => {
  it("renders the headline, description, and CTA exactly as returned by the API", async () => {
    mockedListHeroSlides.mockResolvedValue({
      slides: [makeSlide({ headline: "AUTUMN ARRIVALS 2026", description: "Fresh looks for the new season.", ctaText: "Shop The Edit" })],
    });
    renderHero();
    expect(await screen.findByText("AUTUMN ARRIVALS 2026")).toBeInTheDocument();
    expect(screen.getByText("Fresh looks for the new season.")).toBeInTheDocument();
    expect(screen.getByText(/Shop The Edit/)).toBeInTheDocument();
  });

  it("renders completely different content when the API returns different data — no code change involved", async () => {
    // First render: one campaign.
    mockedListHeroSlides.mockResolvedValue({ slides: [makeSlide({ headline: "SUMMER SALE", ctaText: "Shop Sale" })] });
    const { unmount } = renderHero();
    expect(await screen.findByText("SUMMER SALE")).toBeInTheDocument();
    unmount();

    // Second render: same component, same source file, entirely different
    // API response — simulating an admin changing the hero slide in the DB.
    mockedListHeroSlides.mockReset();
    mockedListHeroSlides.mockResolvedValue({ slides: [makeSlide({ headline: "WINTER COLLECTION LAUNCH", ctaText: "Discover More" })] });
    renderHero();
    expect(await screen.findByText("WINTER COLLECTION LAUNCH")).toBeInTheDocument();
    // The old campaign's text must not linger anywhere.
    expect(screen.queryByText("SUMMER SALE")).not.toBeInTheDocument();
  });

  it("uses the image URL from the API response, not a hardcoded path", async () => {
    mockedListHeroSlides.mockResolvedValue({
      slides: [makeSlide({ headline: "Image Source Test", imageUrl: "/uploads/hero/distinctive-test-key-abc123.jpg" })],
    });
    renderHero();
    const img = await screen.findByAltText("Image Source Test");
    expect(img.getAttribute("src")).toContain("distinctive-test-key-abc123.jpg");
  });

  it("never renders the old hardcoded hero-grid headlines/CTAs that used to exist in this codebase", async () => {
    // Regression guard for the exact hardcoded content removed from
    // hero-grid.tsx during this audit (hardcoded upload UUIDs, "Made for
    // the moment.", "UP TO 70% OFF", "The premium edit"). If any of this
    // ever reappears as a fallback, this test fails.
    mockedListHeroSlides.mockResolvedValue({ slides: [makeSlide({ headline: "Only The Real Slide" })] });
    renderHero();
    await screen.findByText("Only The Real Slide");
    expect(screen.queryByText(/Made for the/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/UP TO 70% OFF/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/The premium edit/i)).not.toBeInTheDocument();
  });
});

describe("HeroCarousel — loading, empty, and error states", () => {
  it("shows a loading placeholder before the API resolves", async () => {
    let resolvePromise: (v: { slides: PublicHeroSlide[] }) => void;
    mockedListHeroSlides.mockReturnValue(
      new Promise((resolve) => { resolvePromise = resolve; })
    );
    renderHero();
    expect(screen.getByLabelText("Loading featured campaigns")).toBeInTheDocument();
    resolvePromise!({ slides: [makeSlide()] });
    await waitFor(() => expect(screen.queryByLabelText("Loading featured campaigns")).not.toBeInTheDocument());
  });

  it("renders nothing (no broken/empty box) when the API returns zero active slides", async () => {
    mockedListHeroSlides.mockResolvedValue({ slides: [] });
    const { container } = renderHero();
    await waitFor(() => expect(mockedListHeroSlides).toHaveBeenCalled());
    // Give the state update a tick, then assert nothing rendered.
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders nothing but logs the failure when the API call fails — the error is not silently swallowed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedListHeroSlides.mockRejectedValue(new Error("network down"));
    const { container } = renderHero();
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    consoleError.mockRestore();
  });
});
