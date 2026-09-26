/**
 * Turns an API failure into the sentence a customer should read.
 *
 * The API's validation errors carry a generic top-level message
 * ("Validation failed.") plus the real, per-field reasons in `fields`
 * (e.g. { password: "Password needs an uppercase letter and a number." }).
 * Pages used to show only the top-level message, which is exactly why sign-up
 * said nothing more useful than "Validation failed". Technical detail (codes,
 * stack, request internals) stays in the server logs; a 5xx only surfaces its
 * request reference so support can find it.
 */
import { ApiError } from "./api";

/** Field-by-field messages, with the bare "This field is required." given the field's name. */
export function fieldErrors(e: unknown, labels: Record<string, string> = {}): Record<string, string> {
  if (!(e instanceof ApiError) || !e.fields) return {};
  const out: Record<string, string> = {};
  for (const [field, msg] of Object.entries(e.fields)) {
    const label = labels[field];
    out[field] = label && /^this field is required\.?$/i.test(msg) ? `${label} is required.` : msg;
  }
  return out;
}

export function userMessage(e: unknown, fallback: string, labels: Record<string, string> = {}): string {
  if (!(e instanceof ApiError)) {
    // fetch() rejects with a TypeError when the network/server is unreachable.
    return e instanceof TypeError ? "We couldn't reach the store. Check your connection and try again." : fallback;
  }
  const details = Object.values(fieldErrors(e, labels));
  if (details.length > 0) return details.join(" ");
  if (e.status >= 500) {
    return `Something went wrong on our side. Please try again in a moment.${e.requestId ? ` (Reference: ${e.requestId.slice(0, 8)})` : ""}`;
  }
  return e.message && !/^validation failed\.?$/i.test(e.message) ? e.message : fallback;
}
