"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { listHeroSlides, type PublicHeroSlide } from "../lib/api";
import { resolveImage, PLACEHOLDER_IMG } from "../lib/imagePlaceholder";

const AUTOPLAY_MS = 6000;
const SWIPE_PX = 34;

function nextIndex(current: number, len: number, dir: number): number {
  if (len === 0) return 0;
  return (current + dir + len) % len;
}

function CtaButton({ slide, tone }: { slide: PublicHeroSlide; tone: "promotional" | "lifestyle" | "editorial" }) {
  const label = slide.ctaText || "Shop Now";
  const hasSecond = !!(slide.cta2Text && slide.cta2Url);

  const renderOne = (text: string, url: string, cls: string) =>
    /^https?:\/\//i.test(url) ? (
      <a href={url} className={`${cls} group inline-flex items-center gap-2`}>
        {text} <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
      </a>
    ) : (
      <Link to={url || "/"} className={`${cls} group inline-flex items-center gap-2`}>
        {text} <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
      </Link>
    );

  let primaryCls = "border border-white/60 px-7 py-4 text-xs font-bold tracking-[.18em] hover:bg-white hover:text-black transition-colors";
  if (tone === "promotional") primaryCls = "bg-white text-black px-7 py-4 text-xs font-black tracking-[.18em] hover:bg-black hover:text-white transition-colors";
  if (tone === "editorial") primaryCls = "border-b border-white/70 pb-1 text-xs font-bold tracking-[.25em] hover:border-white";

  const primary = renderOne(label, slide.ctaUrl, primaryCls);
  if (!hasSecond) return primary;

  // Second button always renders as the outline/secondary treatment,
  // regardless of the slide's tone — this is what makes a two-button
  // slide (e.g. "SHOP MEN" / "SHOP WOMEN") read as two co-equal choices
  // rather than a primary action plus an odd mismatched accent.
  const secondaryCls = "border border-white/60 px-7 py-4 text-xs font-bold tracking-[.18em] hover:bg-white hover:text-black transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-4">
      {primary}
      {renderOne(slide.cta2Text!, slide.cta2Url!, secondaryCls)}
    </div>
  );
}

export function HeroCarousel() {
  const [slides, setSlides] = useState<PublicHeroSlide[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion() === true;
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let mounted = true;
    setStatus("loading");
    listHeroSlides()
      .then((r) => {
        if (!mounted) return;
        const list = r.slides || [];
        setSlides(list);
        setIndex(0);
        setStatus(list.length === 0 ? "empty" : "ready");
      })
      .catch((err) => {
        if (!mounted) return;
        // The hero is decorative — a fetch failure must never break the
        // homepage — but "decorative" doesn't mean "invisible failure".
        // Logging it (rather than a bare empty catch) means a real outage
        // shows up in error monitoring instead of just quietly not
        // rendering a banner with no trace anywhere.
        // eslint-disable-next-line no-console
        console.error("Failed to load hero slides:", err);
        setSlides([]);
        setStatus("error");
      });
    return () => { mounted = false; };
  }, []);

  const N = slides.length;

  // Pause on hover/focus and when the tab is hidden.
  useEffect(() => {
    const onVis = () => setPaused((p) => (document.hidden ? true : p));
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Autoplay — advances between slides on a timer, EXCEPT while the
  // active slide has a video. A video slide is meant to loop
  // continuously and never be cut off mid-playback by the carousel
  // rotating away from it (the whole point of a "video board" hero,
  // per this feature's own explicit "loop continuously" requirement).
  // The customer can still navigate away manually via the dots/arrows.
  useEffect(() => {
    if (reduced || paused || N < 2 || (slides[index]?.videoUrl && !videoError)) return;
    const t = setTimeout(() => {
      setImgError(false);
      setIndex((i) => nextIndex(i, N, 1));
    }, AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [index, reduced, paused, N, slides, videoError]);

  // A newly-active video slide always starts playing (autoplay per this
  // feature's own requirement) — reset whenever the active slide changes,
  // so navigating away from a paused video and back later doesn't leave
  // it stuck paused with no visible way to tell why nothing is moving.
  useEffect(() => {
    setVideoPlaying(true);
    setVideoError(false);
  }, [index]);

  const toggleVideoPlayback = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => undefined); // browser autoplay-policy rejection on a user-initiated play() is vanishingly rare, but never let it throw uncaught
      setVideoPlaying(true);
    } else {
      el.pause();
      setVideoPlaying(false);
    }
  }, []);

  const move = useCallback(
    (dir: number) => {
      setImgError(false);
      setIndex((i) => nextIndex(i, N, dir));
    },
    [N]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
  };

  const drag = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const onPointerDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, active: true }; };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current.active = false;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
  };

  // Loading: a real skeleton (same footprint as the eventual carousel, so
  // nothing jumps once slides arrive) — not a blank gap, and not the
  // carousel markup rendered against an empty array.
  if (status === "loading") {
    return (
      <section
        aria-busy="true"
        aria-label="Loading featured campaigns"
        className="relative w-full bg-[#f5f4f1] overflow-hidden animate-pulse"
        style={{ aspectRatio: "16/8", minHeight: 420 }}
      />
    );
  }

  // Empty (fetch succeeded, zero active campaigns right now) and error
  // (fetch failed) are both deliberate, distinct, logged/testable states —
  // not an accidental fallthrough — but neither one shows the customer a
  // broken-looking box on the homepage: the section simply doesn't render,
  // exactly as it would if no admin had ever configured a hero at all.
  if (status === "empty" || status === "error" || N === 0) return null;

  const tone = slides[index]?.heroType ?? "promotional";

  return (
    <section
      ref={sectionRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured campaigns"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="relative w-full bg-[#f5f4f1] overflow-hidden select-none"
      style={{ touchAction: "pan-y" }}
    >
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "16/8", minHeight: 420 }}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={slides[index].id}
            initial={reduced ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            {slides[index].videoUrl && !videoError ? (
              // No native controls at all — this feature's own explicit
              // requirement is exactly two controls (play/pause), never
              // a scrub bar or the browser's full default control set.
              <video
                ref={videoRef}
                key={slides[index].id}
                src={resolveImage(slides[index].videoUrl!)}
                poster={imgError ? PLACEHOLDER_IMG : resolveImage(slides[index].imageUrl)}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                onError={() => setVideoError(true)}
              />
            ) : (
              <img
                src={imgError ? PLACEHOLDER_IMG : resolveImage(slides[index].imageUrl)}
                alt={slides[index].headline || slides[index].campaignLabel || "Featured campaign"}
                className="absolute inset-0 w-full h-full object-cover"
                loading={index === 0 ? "eager" : "lazy"}
                onError={() => setImgError(true)}
                {...{ fetchpriority: index === 0 ? "high" : "auto" }}
              />
            )}

            {slides[index].videoUrl && !videoError && (
              <button
                type="button"
                onClick={toggleVideoPlayback}
                aria-label={videoPlaying ? "Pause video" : "Play video"}
                // Top-right rather than bottom-right: all three hero tones
                // (promotional=vertically centered, lifestyle=bottom-
                // anchored, editorial=centered) place their text/CTA
                // either centered or toward the bottom-left, and a
                // two-button slide (see CtaButton's hasSecond case) can
                // run wide enough on a narrow phone to approach a
                // bottom-right control. Top-right stays clear of all of
                // that, keeping the control genuinely, not just
                // nominally, separated from the CTA on every tone.
                className="absolute top-5 right-5 md:top-8 md:right-8 z-10 flex h-10 w-10 md:h-11 md:w-11 items-center justify-center rounded-full border border-white/50 bg-black/25 text-white backdrop-blur-sm transition-colors hover:bg-black/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {videoPlaying ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="3" width="5" height="18" /><rect x="14" y="3" width="5" height="18" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3.5v17l15-8.5z" /></svg>
                )}
              </button>
            )}

            {/* Per-type overlay + content treatment */}
            {tone === "promotional" && (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10 md:bg-gradient-to-r md:from-black/80 md:via-black/45 md:to-transparent" />
                <div className="absolute inset-0 flex items-center px-6 md:px-16 lg:px-24">
                  <motion.div
                    initial={reduced ? false : { y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.7, delay: 0.1 }}
                    className="max-w-xl text-white"
                  >
                    {slides[index].badgeText && (
                      <span className="inline-block mb-5 border border-white/40 px-3 py-2 text-[10px] font-bold tracking-[.28em]">
                        {slides[index].badgeText.toUpperCase()}
                      </span>
                    )}
                    <h1 className="text-4xl md:text-7xl font-black uppercase leading-[.9] tracking-[-.05em]">
                      {slides[index].headline}
                    </h1>
                    {slides[index].description && (
                      <p className="mt-5 max-w-md text-sm md:text-base text-white/80">{slides[index].description}</p>
                    )}
                    <div className="mt-8"><CtaButton slide={slides[index]} tone="promotional" /></div>
                  </motion.div>
                </div>
              </>
            )}

            {tone === "lifestyle" && (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                <div className="absolute inset-0 flex items-end px-6 md:px-16 lg:px-24 pb-10 md:pb-16">
                  <motion.div
                    initial={reduced ? false : { y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.7, delay: 0.1 }}
                    className="max-w-lg text-white"
                  >
                    {slides[index].badgeText && (
                      <p className="mb-3 text-[10px] font-bold tracking-[.25em] text-white/70">{slides[index].badgeText.toUpperCase()}</p>
                    )}
                    <h1 className="text-3xl md:text-6xl font-black tracking-[-.04em] uppercase leading-[.95]">{slides[index].headline}</h1>
                    {slides[index].description && (
                      <p className="mt-4 max-w-sm text-sm md:text-base text-white/85">{slides[index].description}</p>
                    )}
                    <div className="mt-7"><CtaButton slide={slides[index]} tone="lifestyle" /></div>
                  </motion.div>
                </div>
              </>
            )}

            {tone === "editorial" && (
              <>
                <div className="absolute inset-0 bg-black/45" />
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                  <motion.div
                    initial={reduced ? false : { y: 16, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.7, delay: 0.1 }}
                    className="text-white"
                  >
                    {slides[index].badgeText && (
                      <p className="mb-4 text-[11px] font-bold tracking-[.35em] text-white/70">{slides[index].badgeText.toUpperCase()}</p>
                    )}
                    <h1 className="text-3xl md:text-7xl font-black uppercase leading-[.92] tracking-[-.04em]">{slides[index].headline}</h1>
                    {(slides[index].editorialText || slides[index].description) && (
                      <p className="mx-auto mt-5 max-w-xl text-sm md:text-base italic text-white/85">
                        {slides[index].editorialText || slides[index].description}
                      </p>
                    )}
                    <div className="mt-8"><CtaButton slide={slides[index]} tone="editorial" /></div>
                  </motion.div>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Side arrows */}
        {N > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous slide"
              onClick={() => move(-1)}
              className="absolute left-3 md:left-5 top-1/2 -translate-y-1/2 hidden sm:flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur text-white border border-white/30 hover:bg-white hover:text-black transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              onClick={() => move(1)}
              className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2 hidden sm:flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur text-white border border-white/30 hover:bg-white hover:text-black transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      {/* Pagination indicators */}
      {N > 1 && (
        <div className="flex items-center justify-center gap-2 py-4" aria-hidden="true">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              tabIndex={-1}
              onClick={() => { setIndex(i); setPaused(true); }}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-7 bg-black" : "w-1.5 bg-black/20 hover:bg-black/40"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
