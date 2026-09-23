// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { useRef } from "react";
import { useAutoScrollCarousel } from "./useAutoScrollCarousel";

/**
 * Headless verification of the premium category-carousel autoplay:
 *
 *  - moves very slowly and continuously forward (never jumps),
 *  - reverses gently at the row's natural bounds and never over-scrolls,
 *  - does nothing when there is no overflow, when autoplay is inactive,
 *    or when the user prefers reduced motion,
 *  - pauses on any pointer interaction and resumes only after the idle
 *    delay — never fighting the user,
 *  - desktop mouse drag-to-scroll moves the content under the cursor and
 *    suppresses the click that follows a real drag (so category links
 *    still open on a plain click).
 *
 * jsdom has no layout, no requestAnimationFrame and an unclamped
 * scrollLeft, so the harness below drive both an rAF queue and a virtual
 * clock explicitly (16ms frames, matching ~60fps).
 */

const ROW_TEST_ID = "cat-row";
const FRAME_MS = 16;

let clock = 0;
let pendingFrames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

function installDrivers() {
  clock = 0;
  pendingFrames = new Map();
  nextFrameId = 0;
  vi.stubGlobal("performance", { now: () => clock } as unknown as Performance);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = ++nextFrameId;
    pendingFrames.set(id, cb);
    window.setTimeout(() => {
      const fn = pendingFrames.get(id);
      if (fn) {
        pendingFrames.delete(id);
        clock += FRAME_MS;
        fn(clock);
      }
    }, FRAME_MS);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    pendingFrames.delete(id);
  };
}

/** Run `ms` of virtual frames by flushing the scheduled rAF timers. */
function advance(ms: number) {
  vi.advanceTimersByTime(ms);
}

interface HarnessProps {
  active?: boolean;
  speed?: number;
  delay?: number;
  children?: React.ReactNode;
}

function Harness({ active = true, speed = 200, delay = 500, children }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  useAutoScrollCarousel({ ref, active, speedPxPerSec: speed, resumeDelayMs: delay });
  return (
    <div ref={ref} data-testid={ROW_TEST_ID}>
      {children ?? (
        <>
          <a href="#cat-1">Cat One</a>
          <a href="#cat-2">Cat Two</a>
        </>
      )}
    </div>
  );
}

/** Make jsdom's metric-less row look like a horizontally overflowing rail. */
function makeOverflowing(row: HTMLElement, contentWidth = 1500, visibleWidth = 500) {
  Object.defineProperty(row, "scrollWidth", { configurable: true, get: () => contentWidth });
  Object.defineProperty(row, "clientWidth", { configurable: true, get: () => visibleWidth });
}

function pointerEvent(type: string, init: { pointerId?: number; pointerType?: string; button?: number; clientX?: number }) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
  });
  Object.defineProperty(ev, "pointerType", { value: init.pointerType ?? "mouse" });
  Object.defineProperty(ev, "pointerId", { value: init.pointerId ?? 1 });
  return ev;
}

beforeEach(() => {
  vi.useFakeTimers();
  installDrivers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useAutoScrollCarousel", () => {
  it("treats a scroll with no recent autoplay write as the user interacting", () => {
    // Chromium marks even programmatic scrollLeft writes as *trusted*, so
    // user-scroll detection cannot rely on e.isTrusted. The rule is "a
    // scroll arriving right after one of our writes is our own movement;
    // any other scroll is the user". jsdom cannot forge trusted events, so
    // this asserts the positive branch: a scroll event with no recent write
    // on its side pauses the autoplay until the idle delay has elapsed.
    render(<Harness delay={500} />);
    const row = screen.getByTestId(ROW_TEST_ID);
    makeOverflowing(row);

    // Dispatch before any frame has run — lastAutoWriteAt is far in the past.
    row.dispatchEvent(new Event("scroll"));

    advance(400); // inside the 500ms idle window -> frozen
    const frozen = row.scrollLeft;
    expect(frozen).toBe(0);

    advance(200); // idle window elapsed -> autoplay resumes
    expect(row.scrollLeft).toBeGreaterThan(frozen);
  });

  it("ignores the scroll events its own writes produce (Chromium quirk)", () => {
    render(<Harness />);
    const row = screen.getByTestId(ROW_TEST_ID);
    makeOverflowing(row);

    advance(500); // autoplay running, several writes already applied
    const before = row.scrollLeft;
    expect(before).toBeGreaterThan(0);

    row.dispatchEvent(new Event("scroll")); // arrives right after a write

    advance(500);
    expect(row.scrollLeft).toBeGreaterThan(before); // still gliding, not frozen
  });

  it("stays still without overflowing content", () => {
    render(<Harness />);
    const row = screen.getByTestId(ROW_TEST_ID);
    makeOverflowing(row, 500, 500); // nothing hidden on the right
    advance(1000);
    expect(row.scrollLeft).toBe(0);
  });

  it("stays still while autoplay is inactive", () => {
    render(<Harness active={false} />);
    const row = screen.getByTestId(ROW_TEST_ID);
    makeOverflowing(row);
    advance(1000);
    expect(row.scrollLeft).toBe(0);
  });

  it("creeps forward slowly and continuously, with tiny per-frame steps", () => {
    render(<Harness />);
    const row = screen.getByTestId(ROW_TEST_ID);
    makeOverflowing(row);
    expect(row.classList.contains("catRow--auto")).toBe(true);

    advance(FRAME_MS); // one frame at 200px/s => 3.2px — a slow, small step
    expect(row.scrollLeft).toBeGreaterThan(0);
    expect(row.scrollLeft).toBeLessThan(25);

    advance(500);
    const after = row.scrollLeft;
    expect(after).toBeGreaterThan(60);
    expect(after).toBeLessThan(150);
  });

  it("reverses gently at the end and never over-scrolls or goes negative", () => {
    render(<Harness />);
    const row = screen.getByTestId(ROW_TEST_ID);
    makeOverflowing(row); // max = 1000

    advance(5000); // ~312 frames ≈ 998px — approaching the far edge
    const nearMax = row.scrollLeft;
    expect(nearMax).toBeGreaterThan(960);
    expect(nearMax).toBeLessThanOrEqual(1000.01);

    advance(64); // bump the cap and flip direction
    const atCap = row.scrollLeft;
    expect(atCap).toBeLessThanOrEqual(1000.01);

    advance(160); // now travelling back
    const returning = row.scrollLeft;
    expect(returning).toBeLessThan(atCap);
    expect(returning).toBeGreaterThanOrEqual(0);
  });

  it("pauses on interaction and resumes only after the idle delay", () => {
    render(<Harness delay={500} />);
    const row = screen.getByTestId(ROW_TEST_ID);
    makeOverflowing(row);

    advance(500);
    const beforeTouch = row.scrollLeft;
    expect(beforeTouch).toBeGreaterThan(0);

    row.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch" }));
    expect(row.classList.contains("catRow--auto")).toBe(false);

    advance(300);
    const duringTouch = row.scrollLeft;
    expect(duringTouch).toBe(beforeTouch); // frozen while interacting

    row.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch" }));

    advance(400); // still inside the 500ms idle window
    expect(row.scrollLeft).toBe(beforeTouch);

    advance(200); // idle window elapsed -> autoplay resumes
    expect(row.scrollLeft).toBeGreaterThan(beforeTouch);
    expect(row.classList.contains("catRow--auto")).toBe(true);
  });

  it("lets a desktop mouse drag move the content and suppresses the click that follows", () => {
    render(<Harness />);
    const row = screen.getByTestId(ROW_TEST_ID);
    makeOverflowing(row);
    const link = row.querySelector("a") as HTMLAnchorElement;
    const linkClick = vi.fn();
    link.addEventListener("click", linkClick);

    row.scrollLeft = 200;
    row.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse", clientX: 10 }));
    row.dispatchEvent(pointerEvent("pointermove", { pointerType: "mouse", clientX: 60 })); // dx 50
    row.dispatchEvent(pointerEvent("pointerup", { pointerType: "mouse", clientX: 60 }));

    expect(row.scrollLeft).toBe(150); // content followed the cursor

    const bubblingClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(bubblingClick);
    expect(linkClick).not.toHaveBeenCalled(); // post-drag click was swallowed

    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(linkClick).toHaveBeenCalledTimes(1); // a plain click still opens the card
  });

  it("respects prefers-reduced-motion by never autoplaying", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
      } as unknown as MediaQueryList)) as typeof window.matchMedia;
    try {
      render(<Harness />);
      const row = screen.getByTestId(ROW_TEST_ID);
      makeOverflowing(row);
      advance(1000);
      expect(row.classList.contains("catRow--auto")).toBe(false);
      expect(row.scrollLeft).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });
});