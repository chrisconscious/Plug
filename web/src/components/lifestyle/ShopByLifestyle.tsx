"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listLifestyles, assetUrl, type Lifestyle } from "../../lib/api";
import { getLifestyleUrl, getLifestylesUrl } from "../../lib/links";
import { ExploreAllLink, ExploreMoreRow } from "../explore-more";

// "SHOP BY LIFESTYLE" — the storefront lifestyle showcase (migration 0019).
//
// Strictly data-driven: cards come from the backend's ACTIVE lifestyles
// (real uploaded hero photos). No hardcoded fallback list — if the taxonomy
// is empty the section is simply absent.
//
// Motion engine:
//   - A single JS loop drives every row with one shared offset, each track
//     scrolling by `offset % period` so the loop is pixel-seamless with
//     frontend-only duplication (product rows are never touched).
//   - NO AUTOPLAY, BY DESIGN: the row never moves on its own. It only moves
//     in response to the customer — a drag/swipe, the resulting flick with
//     decaying momentum, or the previous/next arrow buttons.
//   - prefers-reduced-motion users get native horizontal scrollers instead.
//
// Layout: ONE single horizontal row at every breakpoint (mobile/tablet/
// desktop) — the row never wraps to a second line; the customer discovers
// further lifestyles by swiping/arrowing horizontally. On mobile the built-in
// transform engine handles both directions with no bounce-back.

type Breakpoint = "mobile" | "tablet" | "desktop";

const GAP = 14; // px between slides (mirrors .lsl-track gap)
const RESUME_DELAY_MS = 650; // pause after a drag/flick before momentum is considered settled
const TAP_PAUSE_MS = 400; // short beat even after a simple tap
const MOMENTUM_MIN = 0.25; // px/frame below which a flick stops
const MOMENTUM_DECAY = 0.92; // per-frame damping on a flick
const FRAME_MS = 16.667;

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window === "undefined"
      ? "desktop"
      : window.innerWidth >= 1024
        ? "desktop"
        : window.innerWidth >= 768
          ? "tablet"
          : "mobile"
  );
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        setBp(window.innerWidth >= 1024 ? "desktop" : window.innerWidth >= 768 ? "tablet" : "mobile")
      );
    };
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      cancelAnimationFrame(raf);
    };
  }, []);
  return bp;
}

function LifestyleTile({ l }: { l: Lifestyle }) {
  const img = assetUrl(l.heroImageUrl) || undefined;
  return (
    <Link
      to={getLifestyleUrl(l.slug)}
      className="lsl-slide group block no-underline"
      aria-label={`Shop ${l.name}`}
      data-lsl-slide
    >
      <span className="lsl-card block">
        {img ? <img src={img} alt={l.name} loading="lazy" /> : null}
        <span className="lsl-card-scrim" />
        <span className="lsl-card-body">
          <h4 className="lsl-card-name">{l.name}</h4>
        </span>
      </span>
    </Link>
  );
}

interface FlowingRowsProps {
  items: Lifestyle[];
  arrows: boolean;
}

function FlowingRows({ items, arrows }: FlowingRowsProps) {
  const rows = useMemo(() => [items], [items]);
  const itemCount = rows[0]?.length ?? 0;
  const reduced = useReducedMotion();
  const vpRef = useRef<HTMLDivElement>(null);
  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);
  const periodsRef = useRef<number[]>(rows.map(() => 0));
  const suppressClick = useRef(false);
  const [copies, setCopies] = useState(() => Math.max(4, Math.ceil(8 / Math.max(1, itemCount))));
  const engine = useRef({
    offset: 0,
    last: 0,
    lastT: 0,
    vx: 0,
    momentum: 0,
    dragging: false,
    moved: false,
    startX: 0,
    lastX: 0,
    pausedUntil: 0,
    hover: false,
  }).current;

  const reducedRef = useRef(false);
  reducedRef.current = reduced === true;

  const applyTransforms = useCallback(() => {
    const o = engine.offset;
    periodsRef.current.forEach((p, i) => {
      const el = trackRefs.current[i];
      if (!el || p <= 0) return;
      const mod = ((o % p) + p) % p;
      el.style.transform = `translate3d(${-mod}px,0,0)`;
    });
  }, [engine]);

  const measure = useCallback(() => {
    const vp = vpRef.current;
    const vw = vp?.clientWidth ?? 0;
    let maxPeriod = 0;
    trackRefs.current.forEach((tr, i) => {
      const first = tr ? tr.querySelector<HTMLElement>("[data-lsl-slide]") : null;
      const w = first?.offsetWidth ?? 0;
      const unique = rows[i]?.length ?? 0;
      const p = unique > 0 ? w * unique + GAP * (unique - 1) : 0;
      periodsRef.current[i] = p;
      if (p > maxPeriod) maxPeriod = p;
    });
    if (vw > 0 && maxPeriod > 0) {
      const need = Math.max(2, Math.ceil((vw + GAP) / maxPeriod) + 2);
      setCopies((c) => (c === need ? c : need));
    }
  }, [rows]);

  useEffect(() => {
    const id = requestAnimationFrame(measure);
    const vp = vpRef.current;
    if (!vp) return () => cancelAnimationFrame(id);
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(64, now - engine.last);
      engine.last = now;
      // Autoplay removed by design: this carousel must never move on its
      // own — the only ways it moves are a drag/swipe, its resulting
      // flick-momentum decay (below), or an explicit arrow-button nudge.
      // The engine's pausedUntil/hover/inView bookkeeping is kept because
      // nudge() and the drag handlers still rely on it to avoid a stray
      // momentum carry-over immediately after a manual interaction.
      if (engine.momentum !== 0) {
        engine.offset += engine.momentum * (dt / FRAME_MS);
        engine.momentum *= MOMENTUM_DECAY;
        if (Math.abs(engine.momentum) < MOMENTUM_MIN) {
          engine.momentum = 0;
          engine.pausedUntil = now + RESUME_DELAY_MS;
        }
      }
      applyTransforms();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, applyTransforms, itemCount]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (reducedRef.current) return;
    engine.dragging = true;
    engine.moved = false;
    engine.momentum = 0;
    engine.vx = 0;
    engine.startX = e.clientX;
    engine.lastX = e.clientX;
    engine.lastT = performance.now();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is optional */
    }
    vpRef.current?.classList.add("is-dragging");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!engine.dragging) return;
    const dx = e.clientX - engine.lastX;
    if (!engine.moved && Math.abs(e.clientX - engine.startX) < 6) return;
    engine.moved = true;
    const nowT = performance.now();
    const dtt = Math.max(1, nowT - engine.lastT);
    engine.vx = (dx / dtt) * FRAME_MS;
    engine.lastT = nowT;
    engine.offset -= dx;
    engine.lastX = e.clientX;
    applyTransforms();
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!engine.dragging) return;
    engine.dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* pointer capture is optional */
    }
    vpRef.current?.classList.remove("is-dragging");
    const now = performance.now();
    if (engine.moved) {
      // Flick keeps flowing in the direction of the gesture: momentum = -vx
      // because `offset` grows when content moves LEFT (drag left => vx < 0).
      // (This mirrors the category rail on the lifestyle pages so a swipe never
      // bounces back against the customer's finger.)
      if (Math.abs(engine.vx) >= MOMENTUM_MIN) {
        engine.momentum = -engine.vx;
      } else {
        engine.pausedUntil = now + RESUME_DELAY_MS;
      }
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    } else {
      engine.pausedUntil = now + TAP_PAUSE_MS;
    }
  };

  const onClickGate = (e: React.MouseEvent) => {
    if (suppressClick.current || engine.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Clear both markers so the very next activation (keyboard or tap) is never
    // swallowed because an older drag happened to leave state behind.
    suppressClick.current = false;
    engine.moved = false;
  };

  const nudge = (dir: 1 | -1) => {
    const tr = trackRefs.current[0];
    const first = tr?.querySelector<HTMLElement>("[data-lsl-slide]");
    const w = (first?.offsetWidth ?? 240) + GAP;
    engine.momentum = 0;
    engine.pausedUntil = performance.now() + RESUME_DELAY_MS;
    engine.offset += dir * w;
    applyTransforms();
  };

  const renderTile = (l: Lifestyle, copy: number) => (
    <LifestyleTile key={`${l.id}-c${copy}`} l={l} />
  );

  // prefers-reduced-motion, OR too few real lifestyles to meaningfully
  // loop: plain native horizontal scrollers, each real item rendered
  // EXACTLY ONCE. This is also the fix for a real reported bug — with
  // very few lifestyles, the copies-based wrap-around math below (whose
  // whole point is filling/exceeding the viewport so a drag-loop feels
  // seamless) forced a MINIMUM of 4 copies of the entire row regardless
  // of itemCount. With itemCount=1 that meant the single admin-uploaded
  // lifestyle rendered 4-8 times in the DOM — visually indistinguishable
  // from "the same card duplicated," because that's exactly what it was.
  // Below this threshold there's nothing meaningful to loop (the row
  // doesn't come close to filling a typical viewport even once), so
  // duplicating it for a seamless-loop illusion never made sense in the
  // first place — the ORIGINAL formula's own minimum of 4 is the same
  // number used here, just recognized as a floor below which cloning
  // should not happen at all, not a floor the clone count must reach.
  if (reduced === true || itemCount <= 4) {
    return (
      <div className="lsl-vp lsl-vp-plain" ref={vpRef}>
        <div className="lsl-rows">
          {rows.map((row, i) => (
            <div className="lsl-track lsl-track-plain" key={i} ref={(el) => (trackRefs.current[i] = el)}>
              {row.map((l) => renderTile(l, 0))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="lsl-vp"
      ref={vpRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickGate}
      onPointerEnter={() => {
        engine.hover = true;
      }}
      onPointerLeave={() => {
        engine.hover = false;
        engine.moved = false;
        engine.pausedUntil = performance.now() + RESUME_DELAY_MS;
      }}
    >
      <div className="lsl-rows">
        {rows.map((row, i) => (
          <div
            className="lsl-track"
            key={i}
            ref={(el) => {
              trackRefs.current[i] = el;
            }}
          >
            {Array.from({ length: copies }).flatMap((_, c) => row.map((l) => renderTile(l, c)))}
          </div>
        ))}
      </div>
      {arrows && itemCount >= 2 ? (
        <>
          <button type="button" className="lsl-btn prev" aria-label="Browse earlier lifestyles" onClick={() => nudge(-1)}>
            <ChevronLeft size={20} />
          </button>
          <button type="button" className="lsl-btn next" aria-label="Browse more lifestyles" onClick={() => nudge(1)}>
            <ChevronRight size={20} />
          </button>
        </>
      ) : null}
    </div>
  );
}

export function ShopByLifestyle() {
  const [items, setItems] = useState<Lifestyle[]>([]);
  const [loading, setLoading] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const bp = useBreakpoint();

  // Defer the fetch until the section is near the viewport (below the fold).
  const load = useInView(sectionRef, { once: true, margin: "800px 0px" });

  // "EXPLORE ALL" opens the dedicated /lifestyles page listing EVERY active
  // lifestyle (it used to link to the first lifestyle's products instead).
  const moreLifestyles = !loading && items.length > 0;

  useEffect(() => {
    if (!load) return;
    let mounted = true;
    listLifestyles()
      .then((r) => {
        if (mounted) setItems(r.items ?? []);
      })
      .catch(() => {
        if (mounted) setItems([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [load]);

  const heading = (
    <div className="flex items-end justify-between mb-8 md:mb-10">
      <div className="flex flex-col">
        <p className="text-[10px] font-bold tracking-[.25em] text-black/45 mb-3">GET YOUR STYLE</p>
        <h2 className="text-4xl md:text-6xl font-black tracking-[-.06em] uppercase">Shop by lifestyle</h2>
      </div>
      {moreLifestyles ? (
        <ExploreAllLink
          to={getLifestylesUrl()}
          label="EXPLORE ALL"
          className="hidden shrink-0 md:inline-flex"
        />
      ) : null}
    </div>
  );

  // No active lifestyles (or fetch failed) -> section absent, zero errors.
  if (!loading && items.length === 0) return null;

  return (
    <section ref={sectionRef} className="w-full py-16 md:py-24 bg-white overflow-hidden">
      <div ref={innerRef} className="max-w-[1440px] mx-auto px-4 md:px-8">
        {heading}
        {loading ? (
          /* Skeleton while the lazy fetch is in flight (no layout jump). */
          <div className="flex gap-3.5 overflow-hidden" role="status" aria-label="Loading lifestyles">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="lsl-slide">
                <div className="lsl-card" style={{ background: "#eceae62e" }} />
              </div>
            ))}
          </div>
        ) : (
          <FlowingRows key={bp} items={items} arrows={bp !== "mobile"} />
        )}
        {moreLifestyles ? <ExploreMoreRow to={getLifestylesUrl()} label="EXPLORE ALL" /> : null}
      </div>
    </section>
  );
}