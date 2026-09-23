import { useCallback, useRef, useState } from "react";
import { ApiError } from "../lib/api";

/**
 * Reusable pattern for any mutating action (add to cart, update quantity,
 * remove an item, save a form, etc.): pending state, error feedback, and
 * — critically — prevention of accidental duplicate submission (a second
 * click while the first request is still in flight is ignored, not
 * queued or fired again), all in one place instead of re-implemented
 * per-component with `alert()` or nothing at all for the error case.
 *
 * Deliberately does NOT include a "success" message — what "success"
 * means varies too much by action (sometimes it's a toast, sometimes a
 * navigation, sometimes just the UI updating with new data) to usefully
 * generalize; callers handle that themselves after `run()` resolves.
 *
 * Usage:
 *   const { run, pending, error, clearError } = useAsyncAction(async (id: string) => {
 *     const r = await api.updateCartItemQuantity(id, newQty);
 *     setItems(r.cart.items);
 *   });
 *   <button onClick={() => run(item.id)} disabled={pending}>...</button>
 *   {error && <p role="alert">{error}</p>}
 */
export function useAsyncAction<Args extends unknown[]>(action: (...args: Args) => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not just `pending` state, guards re-entrancy synchronously —
  // relying on `pending` state alone has a window where two rapid clicks
  // both read the pre-update `pending === false` before either state
  // update commits. The ref closes that window.
  const inFlight = useRef(false);

  const run = useCallback(
    async (...args: Args) => {
      if (inFlight.current) return; // accidental duplicate submission — ignored, not queued
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        await action(...args);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [action]
  );

  return { run, pending, error, clearError: () => setError(null) };
}
