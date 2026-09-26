/**
 * The store's configured contact channels (Footer Management), fetched once
 * per page load and shared by every consumer — footer icons, the floating
 * WhatsApp button and the account page's help card.
 *
 * Links are never built here: the API returns each channel's ready-to-open
 * `href` (`https://wa.me/255…`, `tel:+255…`, `mailto:…`, a verified profile
 * URL), so all consumers open exactly the same, validated destination.
 */
import { useEffect, useState } from "react";
import * as api from "./api";

export type ContactLinksState =
  | { status: "loading"; links: api.FooterContactLink[] }
  | { status: "ready"; links: api.FooterContactLink[] }
  | { status: "error"; links: api.FooterContactLink[] };

let pending: Promise<api.FooterContactLink[]> | null = null;

function load(): Promise<api.FooterContactLink[]> {
  if (!pending) {
    pending = api.listFooterContactLinks().then((r) => r.links.filter((l) => !!l.href));
    // A failed load isn't cached — the next consumer that mounts retries.
    pending.catch(() => { pending = null; });
  }
  return pending;
}

export function useContactLinks(): ContactLinksState {
  const [state, setState] = useState<ContactLinksState>({ status: "loading", links: [] });
  useEffect(() => {
    let on = true;
    load()
      .then((links) => { if (on) setState({ status: "ready", links }); })
      .catch(() => { if (on) setState({ status: "error", links: [] }); });
    return () => { on = false; };
  }, []);
  return state;
}

export function findContact(links: api.FooterContactLink[], platform: api.FooterPlatform): api.FooterContactLink | undefined {
  return links.find((l) => l.platform === platform && !!l.href);
}

/** Test hook: forget the shared fetch between tests. */
export function resetContactLinksCache(): void {
  pending = null;
}
