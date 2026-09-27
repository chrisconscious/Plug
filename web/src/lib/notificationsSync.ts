/**
 * Keeps every notification surface (header bell badge, /notifications page)
 * in step after a read/mark-all in any one of them: the one that changed
 * something announces it, the others re-read the real state from the server
 * instead of waiting for the bell's 30-second poll.
 */
const EVENT = "plug:notifications-changed";

export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onNotificationsChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
