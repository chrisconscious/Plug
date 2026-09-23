import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as api from '../lib/api';
import { whatsappHref } from '../lib/contactLinks';

const EXPAND_DELAY_MS = 1000;
const HOLD_MS = 2000;
// Reduced-motion still shows the label (so the affordance isn't lost
// entirely for these users) but on a much shorter, undramatic timeline —
// no eased shape animation, just a brief, plain hold before collapsing.
const REDUCED_MOTION_HOLD_MS = 1800;

type Phase = 'circle' | 'expanded' | 'settled';

/** Configurable label — a prop rather than a hardcoded string, per this feature's own explicit "make it configurable" requirement. */
export function FloatingWhatsAppButton({ label = 'Need Help?' }: { label?: string }) {
  const location = useLocation();
  const [href, setHref] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('circle');
  const reducedRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // The WhatsApp number itself only needs fetching once — it isn't going
  // to change mid-session, and this must never block or repeat on every
  // route change the way the animation itself deliberately does.
  useEffect(() => {
    let on = true;
    api.listFooterContactLinks()
      .then((r) => {
        if (!on) return;
        const wa = r.links.find((l) => l.platform === 'whatsapp');
        setHref(wa?.value ? whatsappHref(wa.value) : null);
      })
      .catch(() => { if (on) setHref(null); });
    return () => { on = false; };
  }, []);

  // Replays the full choreography on every route change, per this
  // feature's own explicit requirement — not just once per site visit.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('circle');

    const holdMs = reducedRef.current ? REDUCED_MOTION_HOLD_MS : HOLD_MS;
    const expandDelay = reducedRef.current ? 200 : EXPAND_DELAY_MS;

    timers.current.push(
      setTimeout(() => setPhase('expanded'), expandDelay),
      setTimeout(() => setPhase('settled'), expandDelay + holdMs)
    );

    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [location.pathname, href]);

  if (!href) return null;

  const expanded = phase === 'expanded';

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} — chat with us on WhatsApp`}
      className={
        'waFab' +
        (expanded ? ' waFab--expanded' : '') +
        (phase === 'settled' ? ' waFab--settled' : '') +
        (reducedRef.current ? ' waFab--reduced' : '')
      }
    >
      <span className="waFabIcon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.78 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.14c-.24.68-1.4 1.3-1.93 1.37-.5.08-1.11.11-1.8-.11a16.5 16.5 0 0 1-1.63-.6c-2.87-1.24-4.74-4.13-4.88-4.32-.14-.19-1.17-1.55-1.17-2.96s.73-2.1 1-2.39c.26-.28.57-.35.76-.35h.55c.18 0 .42-.07.65.5.24.58.82 2 .89 2.15.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.49-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07.16-.19.68-.79.86-1.06.18-.28.36-.23.6-.14.24.09 1.55.73 1.82.86.27.14.45.2.51.32.07.12.07.65-.17 1.33Z" />
        </svg>
      </span>
      <span className="waFabLabel">{label}</span>
    </a>
  );
}
