import "@testing-library/jest-dom/vitest";

// framer-motion's useReducedMotion() calls window.matchMedia, which jsdom
// does not implement. Guarded by `typeof window` so this file is also safe
// to load for the plain "node" environment tests (no window there at all).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
