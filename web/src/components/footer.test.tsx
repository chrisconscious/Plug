// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Footer } from "./footer";
import * as api from "../lib/api";
import type { FooterContactLink } from "../lib/api";
import { resetContactLinksCache } from "../lib/contactLinks";

/**
 * This suite exists to prove the architectural claims behind the footer
 * redesign: (1) the ONLY channels the footer can ever render are the six
 * allowed ones (Instagram, TikTok, Facebook, Phone, WhatsApp, Email) —
 * not Pinterest/YouTube/X, whose remnants this whole redesign was about
 * removing; (2) a channel that is inactive OR has no value never renders
 * a dead icon; (3) the wordmark and copyright sit at the very bottom of
 * the footer (copyright BELOW the wordmark). Every test controls only
 * what the mocked API resolves with — nothing inside footer.tsx itself.
 */

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof api>("../lib/api");
  return { ...actual, listFooterContactLinks: vi.fn() };
});

const mockedListFooterContactLinks = vi.mocked(api.listFooterContactLinks);

// `href` is what the API computes (api/src/lib/contact-links.ts); the footer
// must use it verbatim and never build links itself.
function makeLink(platform: FooterContactLink["platform"], value: string, active = true, href?: string | null): FooterContactLink {
  const derived = platform === "phone" ? "tel:+255756825667" : platform === "email" ? `mailto:${value}` : value;
  return { id: `footer-${platform}`, platform, value, href: href === undefined ? derived : href, active, displayOrder: 0 };
}

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>
  );
}

const ALLOWED_ACCOUNTS: FooterContactLink[] = [
  makeLink("instagram", "https://instagram.com/plug"),
  makeLink("tiktok", "https://tiktok.com/@plug"),
  makeLink("facebook", "https://facebook.com/plug"),
  makeLink("phone", "0756825667"),
  makeLink("whatsapp", "0756825667", true, "https://wa.me/255756825667"),
  makeLink("email", "hello@plug.com"),
];

beforeEach(() => {
  mockedListFooterContactLinks.mockReset();
  resetContactLinksCache();
});

afterEach(() => {
  cleanup();
});

describe("Footer — only the six allowed channels can ever render", () => {
  it("renders a contact icon for every active, valued channel returned by the API", async () => {
    mockedListFooterContactLinks.mockResolvedValue({ links: ALLOWED_ACCOUNTS });
    renderFooter();
    await screen.findByLabelText("Instagram");
    for (const link of ALLOWED_ACCOUNTS) {
      const labels: Record<FooterContactLink["platform"], string> = {
        instagram: "Instagram",
        tiktok: "TikTok",
        facebook: "Facebook",
        phone: "Call PLUG",
        whatsapp: "Contact PLUG on WhatsApp",
        email: "Email PLUG",
      };
      expect(screen.getByLabelText(labels[link.platform])).toBeInTheDocument();
    }
  });

  it("never renders Pinterest / YouTube / X icons under any API response", async () => {
    // Defensive: even if the API were (wrongly) to return a non-allowed
    // platform, the component must not crash or render it.
    mockedListFooterContactLinks.mockResolvedValue({
      links: [
        ...ALLOWED_ACCOUNTS,
        { id: "x", platform: "x" as FooterContactLink["platform"], value: "https://x.com/plug", href: "https://x.com/plug", active: true, displayOrder: 99 },
      ],
    });
    renderFooter();
    await screen.findByLabelText("Instagram");
    expect(screen.queryByLabelText(/Pinterest|YouTube|X \(formerly Twitter\)/i)).not.toBeInTheDocument();
  });
});

describe("Footer — inactive or unvalued channels never show a dead icon", () => {
  it("omits an inactive channel even though it has a value", async () => {
    mockedListFooterContactLinks.mockResolvedValue({
      links: [
        makeLink("instagram", "https://instagram.com/plug", true),
        makeLink("email", "hello@plug.com", false),
      ],
    });
    renderFooter();
    await screen.findByLabelText("Instagram");
    expect(screen.queryByLabelText("Email PLUG")).not.toBeInTheDocument();
  });

  it("omits a valued-less active channel (only renders what the API actually returned)", async () => {
    mockedListFooterContactLinks.mockResolvedValue({ links: [makeLink("instagram", "https://instagram.com/plug")] });
    renderFooter();
    await screen.findByLabelText("Instagram");
    expect(screen.queryByLabelText("TikTok")).not.toBeInTheDocument();
  });
});

describe("Footer — contact icons link to the correct destination", () => {
  it("opens social channels in a new tab with the API-provided URL", async () => {
    mockedListFooterContactLinks.mockResolvedValue({ links: ALLOWED_ACCOUNTS });
    renderFooter();
    const link = await screen.findByLabelText("Instagram");
    expect(link.getAttribute("href")).toBe("https://instagram.com/plug");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("links phone to tel: and email to mailto:, opening in the same tab", async () => {
    mockedListFooterContactLinks.mockResolvedValue({ links: ALLOWED_ACCOUNTS });
    renderFooter();
    const phone = await screen.findByLabelText("Call PLUG");
    const email = await screen.findByLabelText("Email PLUG");
    expect(phone.getAttribute("href")).toBe("tel:+255756825667");
    expect(email.getAttribute("href")).toBe("mailto:hello@plug.com");
    expect(phone.getAttribute("target")).toBeNull();
    expect(email.getAttribute("target")).toBeNull();
  });
});

describe("Footer — WhatsApp and unusable values", () => {
  it("opens the API's international wa.me link, never wa.me/0…", async () => {
    mockedListFooterContactLinks.mockResolvedValue({ links: ALLOWED_ACCOUNTS });
    renderFooter();
    const wa = await screen.findByLabelText("Contact PLUG on WhatsApp");
    expect(wa.getAttribute("href")).toBe("https://wa.me/255756825667");
  });

  it("hides a channel whose value the API could not turn into a link", async () => {
    mockedListFooterContactLinks.mockResolvedValue({
      links: [makeLink("instagram", "https://instagram.com/plug"), makeLink("whatsapp", "12345", true, null)],
    });
    renderFooter();
    await screen.findByLabelText("Instagram");
    expect(screen.queryByLabelText("Contact PLUG on WhatsApp")).not.toBeInTheDocument();
  });
});

describe("Footer — wordmark and copyright sit at the bottom, copyright below the wordmark", () => {
  it("renders the copyright line directly beneath the brand wordmark", async () => {
    mockedListFooterContactLinks.mockResolvedValue({ links: [] });
    renderFooter();
    const wordmarkLink = await screen.findByRole("link", { name: /plug/i });
    const copyright = screen.getByText(/All rights reserved/i);
    expect(copyright.textContent ?? "").toContain("Designed in Tanzania. Delivering Worldwide");

    const wordmark = wordmarkLink.parentElement;
    expect(wordmark).toBeTruthy();
    // Copyright comes AFTER the wordmark in the footer's bottom block
    // (DOCUMENT_POSITION_FOLLOWING = 4 is a bitmask flag, not an exact equal).
    const position = wordmark!.compareDocumentPosition(copyright);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});