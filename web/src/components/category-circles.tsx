"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as api from "../lib/api";
import { getCategoryUrl } from "../lib/links";
import { useAutoScrollCarousel } from "../hooks/useAutoScrollCarousel";
import { CategoryCard } from "./shop/CategoryCard";

/**
 * Homepage "Shop by Category" — genuinely dynamic, not a hardcoded list.
 *
 * An earlier version of this component rendered a fixed 6-item array
 * (QUICK_NAV) and only used the real category API to look up an icon for
 * whichever of those 6 names happened to match a real category slug —
 * the actual set, count, names, and order shown were NOT driven by the
 * admin's real category list at all. That was a real bug, not a stylistic
 * choice, given every relevant product requirement is explicit that this
 * section must reflect exactly what an admin creates/renames/reorders/
 * disables — fixed here by rendering the real, active, ordered category
 * list directly (see catalog.service.ts's listCategories(), which now
 * filters to active=true and orders by display_order).
 *
 * Each card shows the admin-uploaded image (categories.image_url, added
 * in migration 0031) when one exists, falling back to the existing
 * icon-based rendering when it doesn't — never a generated/stock photo.
 *
 * One row, manual navigation (arrow buttons + native touch/trackpad scroll
 * plus desktop mouse drag-to-scroll) combined with a very-slow, continuous
 * autoplay that pauses on any interaction and resumes after a short idle
 * interval, and is disabled entirely for users who choose reduced motion —
 * see useAutoScrollCarousel() for the exact rules (it reuses this same
 * `.catRow`, never duplicates cards, and only slides when content overflows).
 */
export function CategoryCircles() {
  const [categories, setCategories] = useState<api.Category[] | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "empty" | "error">("loading");
  const sectionRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, margin: "800px 0px" });

  const load = () => {
    setStatus("loading");
    api
      .listCategories()
      .then((r) => {
        setCategories(r.categories);
        setStatus(r.categories.length > 0 ? "success" : "empty");
      })
      .catch(() => setStatus("error"));
  };

  useEffect(() => {
    if (!inView) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  // Autoplay only when real categories are on screen — never on skeletons,
  // empty, or errored states. Everything else about the glide (speed, pause
  // on interaction, reduced-motion handling, drag-to-scroll) lives in the hook.
  const categoriesReady = status === "success" && (categories?.length ?? 0) > 0;
  const carousel = useAutoScrollCarousel({ ref: scrollerRef, active: categoriesReady });

  const scrollByCards = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Pause the autoplay while the smooth arrow scroll plays out; it
    // resumes on its own after the configured idle delay.
    carousel.resumeSoon();
    const cardWidth = el.querySelector<HTMLElement>("[data-card]")?.offsetWidth ?? 200;
    el.scrollBy({ left: dir * (cardWidth + 16) * 2, behavior: "smooth" });
  };

  // Nothing configured yet — hide the section rather than show a
  // confusing empty carousel with arrows that do nothing.
  if (status === "empty") return null;

  return (
    <section ref={sectionRef as React.Ref<HTMLElement>} className="categorySection">
      <div className="categorySectionInner">
        <div className="categorySectionHead">
          <span className="categoryAccentLine" aria-hidden="true" />
          <h2>Shop by Category</h2>
          <p>Find your style, explore our top categories</p>
        </div>

        {status === "error" ? (
          <div style={{ padding: "24px 4px" }}>
            <p style={{ color: "#c00", marginBottom: 10, fontSize: 13 }}>Couldn't load categories right now.</p>
            <button type="button" className="blackButton" onClick={load}>RETRY</button>
          </div>
        ) : (
          <div className="categoryCarouselWrap">
            <button
              type="button"
              className="categoryNavBtn categoryNavPrev"
              aria-label="Previous categories"
              onClick={() => scrollByCards(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <div ref={scrollerRef} className="catRow" role="list">
              {status === "loading" && !categories
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="catCard catCardSkeleton" aria-hidden="true" />
                  ))
                : (categories ?? []).map((c) => (
                    <CategoryCard
                      key={c.id}
                      to={getCategoryUrl(c.slug)}
                      imageUrl={c.imageUrl}
                      iconKey={c.icon}
                      name={c.name}
                      listItem
                    />
                  ))}
            </div>
            <button
              type="button"
              className="categoryNavBtn categoryNavNext"
              aria-label="Next categories"
              onClick={() => scrollByCards(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
