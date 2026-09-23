"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface UseAutoScrollCarouselOptions {
  /** The scrollable row element (e.g. the `.catRow` div). */
  ref: RefObject<HTMLElement | null>;
  /** When true the carousel may autoplay (e.g. once content has loaded). */
  active: boolean;
  /** Travel speed in px/second — deliberately slow and continuous. */
  speedPxPerSec?: number;
  /** Quiet interval before autoplay resumes after the user interacts. */
  resumeDelayMs?: number;
}

export interface AutoScrollCarouselApi {
  /** Stop the autonomous movement immediately and keep it stopped. */
  pauseNow: () => void;
  /** Pause now, then resume after `resumeDelayMs` (used by the arrow buttons). */
  resumeSoon: () => void;
}

const AUTO_ROW_CLASS = "catRow--auto";
const DRAGGING_CLASS = "catRow--dragging";

/**
 * Premium, very-slow auto-slide for an overflow-x row, no new dependencies.
 *
 * Design (matches the PLUG category-carousel requirements):
 *  - A single rAF loop advances `scrollLeft` continuously at a low fixed
 *    speed; the direction gently flips at the row's natural bounds, so it
 *    never jumps and no content is ever duplicated/copied (category data
 *    stays exactly what the admin publishes, one card per category).
 *  - It only moves when the row actually overflows, so a short list never
 *    slides and nothing is ever hardcoded.
 *  - Any interaction (touch swipe, mouse/trackpad scroll, the desktop
 *    drag-to-scroll implemented here, arrow-key navigation, a scrollbar
 *    drag, or momentum) pauses the movement and it resumes only after the
 *    user has been idle for `resumeDelayMs` — the carousel never fights
 *    the user and never resumes mid-gesture. Note: Chromium marks even
 *    programmatic scrollLeft writes' scroll events as *trusted*, so our
 *    own writes are identified by timestamp (a scroll right after a write
 *    of ours is ignored), never by `e.isTrusted`.
 *  - `prefers-reduced-motion: reduce` disables autoplay entirely while
 *    manual scrolling, arrows and drag all keep working.
 *  - While autoplaying, `.catRow--auto` forces `scroll-behavior:auto` so
 *    the per-frame writes are not turned into async smooth animations that
 *    would fight the loop (this is the only CSS change needed for a smooth
 *    continuous glide — folding the previous mandatory snap/alignment away).
 *  - Desktop mouse drag-to-scroll follows the content under the cursor and
 *    suppresses the click that follows a true drag, so category links still
 *    open on a plain click without ever navigating after a drag.
 *  - All listeners are detached and the loop cancelled on unmount.
 */
export function useAutoScrollCarousel({
  ref,
  active,
  speedPxPerSec = 22,
  resumeDelayMs = 2200,
}: UseAutoScrollCarouselOptions): AutoScrollCarouselApi {
  const apiRef = useRef<AutoScrollCarouselApi>({ pauseNow: () => {}, resumeSoon: () => {} });

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;

    const reduceMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let direction: 1 | -1 = 1;
    // Fractional position of the glow as a local float: see tick() — writes
    // to scrollLeft carry in whole device pixels in Chromium.
    let pos = el.scrollLeft;
    let interacting = false;
    let resumeTimer: number | null = null;
    let drag: { id: number; startX: number; startScrollLeft: number; moved: boolean } | null = null;
    let suppressClick = false;
    let rafId = 0;
    let lastTs = performance.now();
    // Timestamp of our own last autoplay write — used to tell whether an
    // incoming scroll event is OUR programmatic scroll vs a real user one.
    let lastAutoWriteAt = -Infinity;

    const clearResumeTimer = () => {
      if (resumeTimer !== null) {
        window.clearTimeout(resumeTimer);
        resumeTimer = null;
      }
    };

    const pauseNow = () => {
      interacting = true;
      clearResumeTimer();
      el.classList.remove(AUTO_ROW_CLASS);
    };

    const resumeSoon = () => {
      pauseNow();
      resumeTimer = window.setTimeout(() => {
        resumeTimer = null;
        interacting = false;
        el.classList.add(AUTO_ROW_CLASS);
      }, resumeDelayMs);
    };

    apiRef.current = { pauseNow, resumeSoon };

    const overflows = () => el.scrollWidth - el.clientWidth > 1;

    const tick = (now: number) => {
      rafId = window.requestAnimationFrame(tick);
      const dt = Math.min((now - lastTs) / 1000, 0.1);
      lastTs = now;
      if (interacting) return;
      if (reduceMotion) return;
      if (!overflows()) return;
      const max = el.scrollWidth - el.clientWidth;
      // Chromium stores scroll offsets in whole device pixels, so writing a
      // sub-1px float delta straight to scrollLeft each frame is rounded away
      // and, since the next step is re-derived from the (rounded) readback,
      // the carousel never moves in real browsers either. Keep the true
      // fractional position in a local float and feed the scroll container
      // whole-pixel targets, so the crawl accumulates and the visible row
      // advances in 1px steps (~22px/s => one step every ~45ms).
      // If the position diverges from our float (a user scrollbar drag,
      // arrow click or window resize happened while we were running), the
      // float re-anchors to where the row actually is before moving on.
      if (Math.abs(el.scrollLeft - Math.round(pos)) > 1) pos = el.scrollLeft;
      pos += direction * speedPxPerSec * dt;
      if (direction === 1 && pos >= max) {
        pos = max;
        direction = -1;
      } else if (direction === -1 && pos <= 0) {
        pos = 0;
        direction = 1;
      }
      const left = Math.round(pos);
      el.scrollLeft = left;
      lastAutoWriteAt = performance.now();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button === 0 && overflows()) {
        drag = { id: e.pointerId, startX: e.clientX, startScrollLeft: el.scrollLeft, moved: false };
      }
      // Every interaction (touch tap, mouse down) pauses the autoplay so the
      // row never slides away while the customer is about to open a card.
      pauseNow();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) > 4) {
        drag.moved = true;
        el.classList.add(DRAGGING_CLASS);
      }
      if (drag.moved) el.scrollLeft = drag.startScrollLeft - dx;
    };

    const finishPointer = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) {
        if (drag.moved) suppressClick = true;
        drag = null;
        el.classList.remove(DRAGGING_CLASS);
      }
      resumeSoon();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) resumeSoon();
    };

    const onScroll = () => {
      // Distinguish user scrolling from our own programmatic writes.
      // Browsers disagree on `isTrusted` for script-scrolled elements —
      // Chrome marks even our own scrollLeft writes as *trusted* — so
      // trust the timestamp instead: a scroll arriving right after one of
      // our writes is our own movement; any other scroll (wheel momentum,
      // touch momentum, a scrollbar being dragged) is the user interacting.
      if (performance.now() - lastAutoWriteAt < 120) return;
      resumeSoon();
    };

    const onMouseDown = () => pauseNow();

    if (!reduceMotion) el.classList.add(AUTO_ROW_CLASS);

    el.addEventListener("pointerdown", onPointerDown);
    // Move/up are tracked at window level (no pointer capture) so a drag that
    // leaves the row still ends cleanly — releasing the pointer inside a link
    // stays a normal click on the link (capturing the pointer would retarget
    // the click to the row and swallow every category-card navigation).
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("scroll", onScroll);
    el.addEventListener("wheel", resumeSoon, { passive: true });

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      clearResumeTimer();
      el.classList.remove(AUTO_ROW_CLASS, DRAGGING_CLASS);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", resumeSoon);
    };
  }, [ref, active, speedPxPerSec, resumeDelayMs]);

  return apiRef.current;
}