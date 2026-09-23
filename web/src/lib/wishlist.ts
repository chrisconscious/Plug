import type { Product } from "./api";
import * as api from "./api";

/**
 * Wishlist — server-backed for authenticated users, localStorage for
 * guests, with a one-time merge when a guest with items signs in.
 *
 * The server (via api.ts's listWishlist/addToWishlistServer/
 * removeFromWishlistServer) is the ONLY source of truth once a user is
 * authenticated — this module never trusts localStorage over the server
 * for a logged-in user, and clears the guest localStorage key only after
 * a merge has actually been attempted (never speculatively).
 *
 * `isWishlisted`/`getWishlist` stay synchronous (existing card components
 * read them inside `useState(() => ...)` initializers) by keeping an
 * in-memory cache that's refreshed from the server on auth-mode changes
 * and after every mutation — see setWishlistAuthMode(), called by
 * AuthContext.tsx whenever auth status resolves or changes.
 */

const GUEST_KEY = "vv_wishlist_products3";
const EVENT = "vv:wishlist";

type Mode = "guest" | "authenticated";
let mode: Mode = "guest";

function readGuestFromStorage(): Product[] {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    const parsed = raw ? (JSON.parse(raw) as Product[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistGuest(list: Product[]): void {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(list)); } catch { /* storage unavailable — ephemeral this session */ }
}

function clearGuestStorage(): void {
  try { localStorage.removeItem(GUEST_KEY); } catch { /* ignore */ }
}

function emit(): void {
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* noop */ }
}

// In-memory cache backing the synchronous read functions below. Starts
// from whatever's in guest storage; switched to server data the moment
// auth mode flips to "authenticated" (see setWishlistAuthMode).
let cache: Product[] = readGuestFromStorage();
// Distinguishes "the server genuinely has zero items" from "we couldn't
// reach the server" — conflating the two (as an earlier version of this
// module did) shows a customer's wishlist as falsely empty on a network
// blip, indistinguishable from having never added anything.
let loadError = false;

async function hydrateFromServer(): Promise<void> {
  try {
    const { wishlist } = await api.listWishlist();
    cache = wishlist.map((w) => w.product);
    loadError = false;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Failed to load wishlist from server:", e);
    cache = [];
    loadError = true;
  }
  emit();
}

/**
 * Called by AuthContext.tsx whenever auth status resolves or changes.
 * Transitioning TO authenticated triggers the guest->user merge (if the
 * guest had anything) and then loads the real server wishlist. Guest
 * items are a plain union into the server wishlist — a wishlist has no
 * per-item state to conflict on (unlike a cart's quantities), so
 * "deterministic merge" here just means every guest item gets added
 * exactly once; the backend's own unique constraint absorbs an item
 * already present (that specific failure is expected and ignored).
 * Guest state is cleared only after the merge attempt, never before.
 */
export async function setWishlistAuthMode(authenticated: boolean): Promise<void> {
  if (authenticated) {
    const guestItems = readGuestFromStorage();
    mode = "authenticated";
    if (guestItems.length > 0) {
      await Promise.allSettled(guestItems.map((p) => api.addToWishlistServer(p.id)));
      clearGuestStorage();
    }
    await hydrateFromServer();
  } else {
    mode = "guest";
    loadError = false; // guest mode reads localStorage, not the server — any prior server error no longer applies
    cache = readGuestFromStorage();
    emit();
  }
}

/** Retries loading the wishlist from the server — the retry action behind the error state in Wishlist.tsx. No-op in guest mode (nothing to retry; there's no server call in that mode). */
export async function retryWishlistLoad(): Promise<void> {
  if (mode === "authenticated") {
    await hydrateFromServer();
  }
}

export function getWishlistLoadError(): boolean {
  return loadError;
}

export function getWishlist(): Product[] {
  return cache;
}

export function isWishlisted(slug: string): boolean {
  return cache.some((p) => p.slug === slug);
}

/** Adds/removes a product. Returns `true` if it is now wishlisted. */
export async function toggleWishlist(product: Product): Promise<boolean> {
  const wasWishlisted = cache.some((p) => (mode === "authenticated" ? p.id === product.id : p.slug === product.slug));

  if (mode === "authenticated") {
    // Optimistic update — instant visual feedback, reconciled (or
    // reverted on failure) once the server round-trip completes.
    cache = wasWishlisted ? cache.filter((p) => p.id !== product.id) : [...cache, product];
    emit();
    try {
      const { wishlist } = wasWishlisted
        ? await api.removeFromWishlistServer(product.id)
        : await api.addToWishlistServer(product.id);
      cache = wishlist.map((w) => w.product);
    } catch {
      cache = wasWishlisted ? [...cache, product] : cache.filter((p) => p.id !== product.id); // revert
    }
    emit();
    return !wasWishlisted;
  }

  // Guest path — localStorage only.
  const list = readGuestFromStorage();
  const idx = list.findIndex((p) => p.slug === product.slug);
  if (idx >= 0) list.splice(idx, 1); else list.push(product);
  persistGuest(list);
  cache = list;
  emit();
  return !wasWishlisted;
}

/** Subscribes to wishlist changes. Returns an unsubscribe function. */
export function onWishlistChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
