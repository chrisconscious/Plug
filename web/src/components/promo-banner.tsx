import { useEffect, useState } from "react";
import * as api from "../lib/api";

/**
 * Admin-editable messaging strip (delivery/returns/campaign copy) — see
 * api/db/migrations/0026 and PATCH /api/v1/admin/promo-banner. Previously
 * this was 3 hardcoded strings; an admin can now change this without a
 * code change or redeploy.
 */
export function PromoBanner() {
  const [messages, setMessages] = useState<string[] | null>(null); // null = loading
  const [error, setError] = useState(false);

  useEffect(() => {
    let on = true;
    api.getPromoBanner()
      .then((r) => { if (on) setMessages(r.messages); })
      .catch((e) => {
        if (!on) return;
        // eslint-disable-next-line no-console
        console.error("Failed to load promo banner:", e);
        setError(true);
        setMessages([]);
      });
    return () => { on = false; };
  }, []);

  // Loading and "nothing configured" both render nothing — a thin content
  // strip has no meaningful loading skeleton, and an admin turning it off
  // (or an empty list) is a legitimate, deliberate state, not a bug.
  // A genuine fetch failure is logged (see above) rather than silently
  // indistinguishable from "admin turned it off" — but still doesn't show
  // a broken-looking error strip on every homepage visit for what's
  // purely decorative content.
  if (messages === null || messages.length === 0) return null;

  return (
    <div className="bg-[#f1eee8] border-b border-black/10">
      <div className="max-w-[1440px] mx-auto px-4 py-3 flex flex-wrap justify-center gap-x-12 gap-y-1 text-[10px] md:text-[11px] font-bold tracking-[.14em]">
        {messages.map((msg, i) => (
          <span key={i} className="flex items-center gap-x-12">
            {i > 0 && <span className="text-black/25">•</span>}
            {msg}
          </span>
        ))}
      </div>
    </div>
  );
}
