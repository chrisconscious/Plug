import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Package, CreditCard, Tag, Megaphone, Heart, Boxes, Users, ShieldAlert, Shield } from 'lucide-react';
import * as api from '../lib/api';

const CATEGORY_ICON: Record<api.NotificationCategory, React.ReactNode> = {
  ORDER: <Package size={15} />,
  PAYMENT: <CreditCard size={15} />,
  PRODUCT: <Tag size={15} />,
  PROMOTION: <Megaphone size={15} />,
  WISHLIST: <Heart size={15} />,
  INVENTORY: <Boxes size={15} />,
  CUSTOMER: <Users size={15} />,
  SYSTEM: <ShieldAlert size={15} />,
  ADMIN: <ShieldAlert size={15} />,
  SECURITY: <Shield size={15} />,
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Polls the dedicated /unread-count endpoint (never the full list) every
 * 30s — a pragmatic, dependency-free stand-in for real-time given this
 * project has no WebSocket/SSE infrastructure to reuse (checked before
 * building this), matching the brief's own "don't introduce unnecessary
 * dependencies" instruction. The dropdown's full list is only fetched
 * when the customer actually opens it, not on every poll tick.
 */
export function NotificationBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<api.AppNotification[] | null>(null);
  const [marking, setMarking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let on = true;
    const poll = () => api.getUnreadNotificationCount().then((r) => { if (on) setUnread(r.count); }).catch(() => {});
    poll();
    const id = setInterval(poll, 30000);
    return () => { on = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!open) return;
    let on = true;
    api.listNotifications(1, 20).then((r) => { if (on) setItems(r.notifications); }).catch(() => { if (on) setItems([]); });
    return () => { on = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false); };
    const onEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onEscape); };
  }, [open]);

  const openNotification = async (n: api.AppNotification) => {
    if (!n.isRead) {
      setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? cur);
      setUnread((c) => Math.max(0, c - 1));
      api.markNotificationRead(n.id).catch(() => {});
    }
    setOpen(false);
    if (n.actionUrl) nav(n.actionUrl);
  };

  const markAllRead = async () => {
    setMarking(true);
    try {
      await api.markAllNotificationsRead();
      setItems((cur) => cur?.map((x) => ({ ...x, isRead: true })) ?? cur);
      setUnread(0);
    } catch {
      /* best-effort — the next poll will reconcile the real count regardless */
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="notifWrap" ref={panelRef}>
      <button
        type="button"
        className="iconBtn desktopOnlyIcon notifBellBtn"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={19} />
        {unread > 0 && <span className="notifBadge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <>
          <div className="notifBackdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="notifPanel" role="dialog" aria-label="Notifications">
            <span className="notifDrawerHandle" aria-hidden="true" />
          <div className="notifPanelHead">
            <b>Notifications</b>
            {items && items.some((n) => !n.isRead) && (
              <button type="button" className="notifMarkAll" disabled={marking} onClick={markAllRead}>Mark all as read</button>
            )}
          </div>
          <div className="notifList">
            {items === null ? (
              <div className="notifLoading">Loading…</div>
            ) : items.length === 0 ? (
              <div className="notifEmpty">
                <p>You're all caught up.</p>
                <span>No new notifications right now.</span>
              </div>
            ) : (
              items.map((n) => (
                <button type="button" key={n.id} className={'notifItem' + (n.isRead ? '' : ' unread')} onClick={() => openNotification(n)}>
                  <span className="notifItemIcon">
                    {n.imageUrl ? <img src={api.assetUrl(n.imageUrl)} alt="" /> : CATEGORY_ICON[n.category]}
                  </span>
                  <span className="notifItemBody">
                    <span className="notifItemTitle">{n.title}</span>
                    <span className="notifItemMsg">{n.message}</span>
                    <span className="notifItemTime">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.isRead && <span className="notifDot" aria-hidden="true" />}
                </button>
              ))
            )}
          </div>
          <button type="button" className="notifViewAll" onClick={() => { setOpen(false); nav('/notifications'); }}>
            View all notifications
          </button>
          </div>
        </>
      )}
    </div>
  );
}
