import * as api from "./api";

/**
 * Lightweight, reactive cart-item-count cache — same design as wishlist.ts
 * (a synchronous cached read + subscription), built specifically so the
 * mobile bottom nav's cart badge doesn't need its own independent poll of
 * the cart endpoint, and so any future consumer can share this one source
 * instead of each page re-fetching the same count.
 */

let count = 0;
let hasLoaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Cached count, safe to read synchronously (e.g. on first render before the initial fetch resolves) — 0 until the first real load completes. */
export function getCartCount(): number {
  return count;
}

export function hasCartCountLoaded(): boolean {
  return hasLoaded;
}

/**
 * Re-fetches the real cart from the server and updates the cached count.
 * Call this after any successful cart mutation (add/update/remove/clear)
 * so every subscriber (the bottom nav badge, and anywhere else that later
 * adopts this module) reflects the change immediately — this is the
 * "update immediately, no page refresh" behavior, driven by the same
 * real data every other cart view already uses, not a separate guess.
 */
/**
 * Sets the count directly from cart items the caller already has in hand
 * (e.g. the response of updateCartItemQuantity/removeCartItem, which
 * already returns the fresh cart) — avoids a redundant second fetch that
 * refreshCartCount() would otherwise trigger for data the caller already
 * has. Prefer this over refreshCartCount() whenever a fresh cart is
 * already available from the mutation's own response.
 */
export function setCartCountFromItems(items: { quantity?: number | null }[]): void {
  count = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  hasLoaded = true;
  emit();
}

export async function refreshCartCount(): Promise<void> {
  try {
    const { cart } = await api.getCart();
    count = (cart.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  } catch {
    // A logged-out visitor or a transient failure both land here — 0 is
    // the correct, safe display either way (no cart to show a count for,
    // or "we don't currently know" rendered as nothing rather than a
    // stale/wrong number).
    count = 0;
  } finally {
    hasLoaded = true;
    emit();
  }
}

/** Called on logout (or any point the session is known to be gone) so the badge doesn't keep showing a previous user's count. */
export function clearCartCount(): void {
  count = 0;
  hasLoaded = true;
  emit();
}

export function onCartCountChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
