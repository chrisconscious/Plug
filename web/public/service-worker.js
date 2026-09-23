// PLUG service worker — deliberately minimal and conservative.
//
// This is an e-commerce site: caching the WRONG thing (a stale price, a
// stale cart, a stale order-confirmation) is a real business risk, not
// just a UX annoyance. So this worker caches ONLY the static app shell
// (JS/CSS bundles, fonts, the manifest, icons) and NEVER touches:
//   - anything under /api/ (every price, inventory, cart, order, auth,
//     and payment response comes from here — always network-only)
//   - navigation requests for checkout/cart/account/login pages (served
//     fresh so a customer never lands on stale checkout state)
//   - Vite DEV module URLs (see isDevModule below). In development the
//     browser fetches source files like /src/index.css over the network;
//     that CSS is served as a JS module and changes on every edit, so
//     cache-first on it would serve permanently-stale styles.
//
// A cache-first strategy is used ONLY for the static asset cache, and
// even then falls back to the network on a miss rather than assuming
// the cache is complete.
//
// v2: bumped from v1 so any previously-persisted stale module cache
// (e.g. an index.css captured before new styles existed) is purged by the
// activate handler, and dev module URLs are never cached at all.

const CACHE_NAME = "plug-static-v2";
const STATIC_CACHE_URL_PATTERN = /\.(?:js|css|woff2?|ttf|svg|png|webp|jpg|jpeg)$/;

// Paths that must NEVER be served from cache, even opportunistically —
// checked before anything else, regardless of file extension.
const NEVER_CACHE_PATTERNS = [/^\/api\//, /\/checkout/, /\/cart/, /\/login/, /\/register/, /\/profile/, /\/orders/, /\/admin/, /\/super-admin/];

// Vite dev-time module URLs. /@vite/client, /@react-refresh, /@fs/*,
// /node_modules/* and every /src/* source module (including index.css,
// which Vite exposes as a mutable JS module at that path during dev)
// must always hit the network, otherwise edits never appear.
function isDevModule(url) {
  return (
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/node_modules/") ||
    url.pathname.startsWith("/%40")
  );
}

function isNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some((p) => p.test(url.pathname)) || isDevModule(url);
}

self.addEventListener("install", (event) => {
  // Activate immediately rather than waiting for all tabs to close —
  // this worker only affects static assets, so there's no risk of an
  // old tab seeing an inconsistent app version mid-session.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only ever handle same-origin GET requests — anything else (POST order
  // creation, cross-origin requests, etc.) is left completely untouched,
  // falling through to the network exactly as if this worker didn't exist.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (isNeverCache(url)) return;
  if (!STATIC_CACHE_URL_PATTERN.test(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      // Only cache genuinely successful, basic (same-origin, non-opaque)
      // responses — never cache an error page as if it were the real asset.
      if (response.ok && response.type === "basic") {
        cache.put(event.request, response.clone());
      }
      return response;
    })
  );
});