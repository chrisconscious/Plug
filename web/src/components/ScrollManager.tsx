import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const STORE_KEY = "plug.scroll.v1";
const MAX_ENTRIES = 60;
/** How long a Back/Forward restore keeps trying while the page's content loads in. */
const RESTORE_WINDOW_MS = 3000;
/** The restored position must hold this long before the restore stops watching. */
const SETTLE_MS = 800;

function readStore(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, number>) {
  try {
    const keys = Object.keys(store);
    if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete store[k];
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable (private mode): positions just aren't kept across reloads */
  }
}

const jump = (top: number) => window.scrollTo({ top, left: 0, behavior: "instant" as ScrollBehavior });

/**
 * One scroll policy for the whole storefront (the router keeps none):
 * - opening a new page (link, button, redirect) starts at the top;
 * - Back / Forward returns to exactly where the customer was on that page,
 *   retrying briefly while lazy sections and lists load back in, and giving
 *   up the moment the customer scrolls or touches the page themselves;
 * - changing only the query on the same page (filters, sort, paging) keeps
 *   the current position;
 * - a #hash link scrolls to its target.
 */
export function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType();
  const positions = useRef<Record<string, number>>(readStore());
  // A history entry's key plus its address: the first entry of every page
  // load is keyed "default", so the key alone can collide across reloads.
  const entryId = (l: { key: string; pathname: string; search: string }) => `${l.key}|${l.pathname}${l.search}`;
  const currentKey = useRef(entryId(location));
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    let frame = 0;
    const save = () => {
      frame = 0;
      positions.current[currentKey.current] = Math.round(window.scrollY);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(save);
    };
    const persist = () => writeStore(positions.current);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    const samePath = prevPath.current === location.pathname;
    prevPath.current = location.pathname;
    currentKey.current = entryId(location);
    writeStore(positions.current);

    if (navType === "POP") {
      const target = positions.current[entryId(location)];
      if (target === undefined) return;
      const started = Date.now();
      let timer = 0;
      const stop = () => {
        window.clearTimeout(timer);
        for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.removeEventListener(ev, stop);
      };
      for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(ev, stop, { passive: true });
      // Keep re-applying until the position has held for a moment: while the
      // page re-renders (lazy sections, refetched lists) it can briefly get
      // shorter, and the browser then clamps the scroll back to the top.
      let heldSince = 0;
      const attempt = () => {
        const now = Date.now();
        if (Math.abs(window.scrollY - target) > 2) {
          jump(target);
          heldSince = 0;
        } else if (!heldSince) {
          heldSince = now;
        }
        if ((heldSince && now - heldSince >= SETTLE_MS) || now - started > RESTORE_WINDOW_MS) return stop();
        timer = window.setTimeout(attempt, 50);
      };
      attempt();
      return stop;
    }

    if (location.hash) {
      const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    if (!samePath) jump(0);
  }, [location.key, location.pathname, location.search, location.hash, navType]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
