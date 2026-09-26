"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInView } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  listBrands,
  getBrandSectionSettings,
  assetUrl,
  type Brand,
  type BrandSectionSpeed,
} from "../lib/api";
import { useAutoScrollCarousel } from "../hooks/useAutoScrollCarousel";
import { getBrandUrl, getBrandsUrl } from "../lib/links";
import { ExploreAllLink, ExploreMoreRow } from "./explore-more";
import { BrandMark } from "./shop/BrandMark";

/**
 * "SHOP BY BRAND" — a single horizontal, editorial carousel row of large
 * portrait fashion cards, one card per ACTIVE brand, in the admin's
 * display order (no hardcoding, no duplication: N brands => exactly N
 * cards, ever).
 *
 * Card: full-bleed campaign photo (campaignImage) OR a quiet neutral tile
 * when the admin hasn't uploaded one; the brand's own uploaded logo sits
 * dead-centre (forced to a white silhouette over any photo so every logo
 * stays legible), and brands without a logo fall back to a wide-tracked
 * uppercase NAME wordmark — the dominant, data-driven treatment since the
 * majority of real brands currently have neither logo nor campaign image.
 *
 * Motion (all existing architecture, deliberately reused — nothing new):
 *  - The row is the shared `.catRow` used by the whole PLUG category
 *    system, so it inherits the native finger swipe / trackpad scroll /
 *    wheel handling and the desktop mouse drag-to-scroll + click
 *    suppression that `useAutoScrollCarousel` already provides.
 *  - Autoplay: a very-slow, continuous glide driven by the SAME hook the
 *    category circles use, honoring the EXISTING admin-managed
 *    `homepage_brand_settings.brand_logo_speed` (slow/medium/fast). It
 *    only moves when the row overflows, pauses on ANY interaction and
 *    resumes only after the user has been idle, never fights the finger,
 *    and is disabled entirely for `prefers-reduced-motion`.
 *  - Keyboard users can focus the row and arrow/Home/End through it.
 *  - Arrows are a desktop-only, minimal affordance; mobile gets a
 *    hand's-width peek of the next card to signal swiping.
 *
 * Everything here loads from the real brand API when the section nears the
 * viewport; an empty/errored catalogue simply hides the section.
 */
export function ShopByBrands() {
  const [brandItems, setBrandItems] = useState<Brand[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [speed, setSpeed] = useState<BrandSectionSpeed>("medium");

  const sectionRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLUListElement | null>(null);

  // Defer the fetch until the section is near the viewport (below the fold).
  const loadBrandsWhenNear = useInView(sectionRef, { once: true, margin: "800px 0px" });

  useEffect(() => {
    if (!loadBrandsWhenNear) return;
    let mounted = true;
    listBrands()
      .then((r) => {
        if (!mounted) return;
        const active = r.brands.filter((b) => b.active);
        active.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
        setBrandItems(active);
      })
      .catch(() => {
        /* decorative section; fail silently rather than block the homepage */
      })
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    // The premium autoplay speed is the admin's existing brand-section
    // setting (slow/medium/fast) — already migrated + API-backed, so we
    // consume it rather than adding a second management surface.
    getBrandSectionSettings()
      .then((r) => {
        if (mounted) setSpeed(r.speed);
      })
      .catch(() => {
        /* keep the "medium" default on any failure */
      });
    return () => {
      mounted = false;
    };
  }, [loadBrandsWhenNear]);

  const carousel = useAutoScrollCarousel({
    ref: trackRef,
    active: loaded && brandItems.length > 0,
    speedPxPerSec: AUTO_SPEED_PX[speed],
  });

  // "EXPLORE ALL" only when the rail shows a window of a larger catalogue:
  // more ACTIVE brands exist than the viewport fits in one screen.
  // EXPLORE ALL always leads to the full /brands page (search, A–Z, every
  // active brand) — shown whenever there is at least one brand, not only when
  // the row overflows.
  const moreBrands = loaded && brandItems.length > 0;

  const reducedScrollBehavior = (): "smooth" | "auto" =>
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

  const scrollByCards = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    // Pause the autoplay while the smooth arrow scroll plays out; it
    // resumes on its own after the configured idle delay.
    carousel.resumeSoon();
    const card = el.querySelector<HTMLElement>("[data-brand-card]");
    const step = (card?.offsetWidth ?? 240) + 16;
    el.scrollBy({ left: dir * step * 2, behavior: reducedScrollBehavior() });
  };

  const onRowKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-brand-card]");
    const step = (card?.offsetWidth ?? 240) + 16;
    const behavior = reducedScrollBehavior();
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        carousel.resumeSoon();
        el.scrollBy({ left: step, behavior });
        break;
      case "ArrowLeft":
        e.preventDefault();
        carousel.resumeSoon();
        el.scrollBy({ left: -step, behavior });
        break;
      case "Home":
        e.preventDefault();
        carousel.resumeSoon();
        el.scrollTo({ left: 0, behavior });
        break;
      case "End":
        e.preventDefault();
        carousel.resumeSoon();
        el.scrollTo({ left: el.scrollWidth, behavior });
        break;
    }
  };

  if (loaded && brandItems.length === 0) return null;

  return (
    <section ref={sectionRef} className="w-full overflow-hidden bg-white py-16 md:py-24">
      <div className="mx-auto max-w-[1440px] px-4 md:px-8">
        <div className="mb-8 flex items-end justify-between gap-6 md:mb-10">
          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[.25em] text-black/45">Explore by label</p>
            <h2 className="text-4xl font-black uppercase leading-none tracking-[-.02em] md:text-5xl">Shop by brand</h2>
          </div>
          <div className="hidden shrink-0 items-center gap-3 md:flex">
            {moreBrands ? <ExploreAllLink to={getBrandsUrl()} /> : null}
            <div className="ml-4 flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous brands"
                onClick={() => scrollByCards(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-black/70 transition-colors hover:border-black/30 hover:text-black"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                aria-label="Next brands"
                onClick={() => scrollByCards(1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-black/70 transition-colors hover:border-black/30 hover:text-black"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>

        <ul
          ref={trackRef}
          role="list"
          aria-label="Shop by brand"
          tabIndex={0}
          onKeyDown={onRowKeyDown}
          className="catRow m-0 list-none p-0 outline-none focus-visible:ring-2 focus-visible:ring-black/60 focus-visible:ring-offset-4"
        >
          {!loaded
            ? Array.from({ length: 5 }).map((_, i) => (
                <li key={i} aria-hidden="true" className="aspect-[2/3] w-[calc(46%-5px)] shrink-0 animate-pulse rounded-2xl bg-black/[0.04] sm:w-[44%] md:w-[30%] lg:w-[24%] xl:w-[22%]" />
              ))
            : brandItems.map((b) => {
                const photo = Boolean(b.campaignImage?.url);
                return (
                  <li key={b.id} className="aspect-[2/3] w-[calc(46%-5px)] shrink-0 sm:w-[44%] md:w-[30%] lg:w-[24%] xl:w-[22%]">
                    <Link
                      to={getBrandUrl(b.slug)}
                      data-brand-card
                      aria-label={`Shop ${b.name}`}
                      draggable={false}
                      className="group relative block h-full w-full overflow-hidden rounded-2xl bg-[#f4f2ee] outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-4"
                    >
                      {photo ? (
                        <>
                          <img
                            src={assetUrl(b.campaignImage!.url)}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                          />
                          {/* Ambient scrim keeps the centered mark legible over any photo */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/5 to-black/15" />
                        </>
                      ) : (
                        <div className="absolute inset-0 border border-black/[0.05]" />
                      )}
                      <span className={`brandCardMark ${photo ? "brandCardMark--photo" : "brandCardMark--plain"}`}>
                        <BrandMark brand={b} surface={photo ? "photo" : "light"} alt="" wordmarkClassName="brandWord" />
                      </span>
                    </Link>
                  </li>
                );
              })}
        </ul>

        {moreBrands ? <ExploreMoreRow to={getBrandsUrl()} /> : null}
      </div>
    </section>
  );
}

/** Existing admin-managed autoplay levels -> very slow px/sec glide. */
const AUTO_SPEED_PX: Record<BrandSectionSpeed, number> = {
  slow: 12,
  medium: 22,
  fast: 34,
};