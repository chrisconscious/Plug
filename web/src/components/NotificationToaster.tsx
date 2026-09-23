import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import * as api from '../lib/api';
import { useAuth } from '../lib/AuthContext';

const TOAST_DURATION_MS = 6000;
const POLL_MS = 30000;

/**
 * Independent poller from NotificationBell — a deliberate, small
 * tradeoff (one extra lightweight /unread-count-adjacent call every 30s)
 * rather than refactor the already-working bell into a shared context
 * right now, which would be a larger, riskier change for this pass.
 * Detects a genuinely NEW notification by comparing the most recent
 * item's id against the last one already seen (tracked in a ref, not
 * state, since it must never trigger its own re-render/re-poll).
 */
export function NotificationToaster() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [toasts, setToasts] = useState<api.AppNotification[]>([]);
  const lastSeenId = useRef<string | null>(null);
  const initialized = useRef(false);
  // Tracks every per-toast dismissal timer so they can ALL be cleared on
  // unmount — previously untracked, meaning a toast's setTimeout could
  // still fire (calling setToasts on an unmounted component) if this
  // component ever unmounted while a toast was mid-display.
  const dismissTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    if (!user) return;
    let on = true;

    const poll = async () => {
      try {
        const { notifications } = await api.listNotifications(1, 1);
        const latest = notifications[0];
        if (!latest || !on) return;
        if (!initialized.current) {
          // First poll after mount/login just establishes the baseline —
          // never toast for something that already existed before this
          // component was watching, only for what arrives AFTER.
          initialized.current = true;
          lastSeenId.current = latest.id;
          return;
        }
        if (latest.id !== lastSeenId.current) {
          lastSeenId.current = latest.id;
          setToasts((cur) => [...cur, latest]);
          const timer = setTimeout(() => {
            dismissTimers.current.delete(timer);
            setToasts((cur) => cur.filter((t) => t.id !== latest.id));
          }, TOAST_DURATION_MS);
          dismissTimers.current.add(timer);
        }
      } catch {
        /* best-effort — a missed poll just means a slightly later toast, or none if dismissed by the time the next one succeeds */
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      on = false;
      clearInterval(id);
      dismissTimers.current.forEach((t) => clearTimeout(t));
      dismissTimers.current.clear();
    };
  }, [user]);

  const dismiss = (id: string) => setToasts((cur) => cur.filter((t) => t.id !== id));

  const openToast = (n: api.AppNotification) => {
    dismiss(n.id);
    if (n.actionUrl) nav(n.actionUrl);
  };

  if (toasts.length === 0) return null;

  return (
    <div className="toastStack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toastCard">
          <button type="button" className="toastBody" onClick={() => openToast(t)}>
            <span className="toastTitle">{t.title}</span>
            <span className="toastMsg">{t.message}</span>
          </button>
          <button type="button" className="toastClose" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
