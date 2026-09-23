import { useEffect, useState, type RefObject } from "react";

/**
 * How many child slides currently fit inside a horizontal rail's viewport —
 * the real, measured "nothing more to swipe" threshold used by homepage
 * shelves to decide whether the EXPLORE ALL action should appear.
 *
 * Measures the actual rendered geometry (first slide width + row gap) and
 * re-measures on resize. Returns Infinity ("can't tell", so callers hide the
 * CTA) until the first measurement succeeds — which also keeps SSR and jsdom
 * tests deterministic. Pass `gap` when the rail hard-sets its own spacing
 * (the Lifestyle engine uses a fixed 14px track gap); otherwise the CSS gap
 * from the observed element is used.
 */
export function useVisibleCount<T extends HTMLElement>(
  ref: RefObject<T | null>,
  slideSelector: string,
  gap?: number
): number {
  const [count, setCount] = useState<number>(Infinity);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // jsdom/SSR have no layout to measure — stay "can't tell".
    if (typeof ResizeObserver === "undefined") return;

    let raf = 0;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const slide = el.querySelector<HTMLElement>(slideSelector);
        const vw = el.clientWidth;
        if (!slide || vw < 1) return;
        let g = gap;
        if (g === undefined) {
          const parsed = parseFloat(getComputedStyle(el).gap || "0");
          g = Number.isNaN(parsed) ? 0 : parsed;
        }
        const slot = slide.offsetWidth + g;
        setCount(Math.max(1, Math.floor(vw / slot)));
      });
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    // ResizeObserver alone is not enough: when a shelf's skeleton (same card
    // dimensions) is swapped for the real API data the observed box size does
    // NOT change, so RO never fires and the count stays at Infinity. Re-measure
    // on any child mutation too — data load and layout shifts both re-run the
    // cheap measurement instead of leaving the CTA stuck hidden.
    const mutations = new MutationObserver(compute);
    mutations.observe(el, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mutations.disconnect();
    };
  }, [ref, slideSelector, gap]);

  return count;
}