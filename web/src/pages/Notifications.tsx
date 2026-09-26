import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Package, CreditCard, Tag, Megaphone, Heart, Boxes, Users, ShieldAlert, Shield, Bell } from 'lucide-react';
import * as api from '../lib/api';
import { StoreHeader } from '../components/shop/StoreHeader';
import { useAuth } from '../lib/AuthContext';
import { loginUrl, currentLocation } from '../lib/returnTo';

const CATEGORY_ICON: Record<api.NotificationCategory, React.ReactNode> = {
  ORDER: <Package size={16} />,
  PAYMENT: <CreditCard size={16} />,
  PRODUCT: <Tag size={16} />,
  PROMOTION: <Megaphone size={16} />,
  WISHLIST: <Heart size={16} />,
  INVENTORY: <Boxes size={16} />,
  CUSTOMER: <Users size={16} />,
  SYSTEM: <ShieldAlert size={16} />,
  ADMIN: <ShieldAlert size={16} />,
  SECURITY: <Shield size={16} />,
};

const TABS: { label: string; categories: api.NotificationCategory[] | null }[] = [
  { label: 'All', categories: null },
  { label: 'Orders', categories: ['ORDER', 'PAYMENT'] },
  { label: 'Products', categories: ['PRODUCT', 'INVENTORY', 'WISHLIST'] },
  { label: 'Promotions', categories: ['PROMOTION'] },
  { label: 'System', categories: ['SYSTEM', 'ADMIN', 'SECURITY', 'CUSTOMER'] },
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

function Notifications() {
  const nav = useNavigate();
  const { status: authStatus, user } = useAuth();
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<api.AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const pageSize = 20;

  const load = (p: number, append: boolean) => {
    setStatus('loading');
    api.listNotifications(p, pageSize)
      .then((r) => {
        setItems((cur) => (append ? [...cur, ...r.notifications] : r.notifications));
        setTotal(r.total);
        setStatus('success');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    if (!user) return;
    setPage(1);
    load(1, false);
  }, [user]);

  const activeTab = TABS[tab];
  const filtered = activeTab.categories ? items.filter((n) => activeTab.categories!.includes(n.category)) : items;

  const openNotification = async (n: api.AppNotification) => {
    if (!n.isRead) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      api.markNotificationRead(n.id).catch(() => {});
    }
    if (n.actionUrl) nav(n.actionUrl);
  };

  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setItems((cur) => cur.map((x) => ({ ...x, isRead: true })));
    } catch { /* the header bell's own poll will reconcile regardless */ }
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(next, true);
  };

  if (authStatus === 'loading') {
    return (
      <div>
        <StoreHeader />
        <main className="notifPage"><div className="accSkelBlock" style={{ height: 300 }} /></main>
      </div>
    );
  }

  if (!user) {
    return (
      <div>
        <StoreHeader />
        <main className="notifPage">
          <p>Please <Link to={loginUrl(currentLocation())}>sign in</Link> to view your notifications.</p>
        </main>
      </div>
    );
  }

  return (
    <div>
      <StoreHeader />
      <main className="notifPage">
        <div className="notifPageHead">
          <h1>Notifications</h1>
          {items.some((n) => !n.isRead) && <button type="button" className="accLinkBtn" onClick={markAllRead}>MARK ALL AS READ</button>}
        </div>

        <div className="notifTabs" role="tablist">
          {TABS.map((t, i) => (
            <button key={t.label} type="button" role="tab" aria-selected={tab === i} className={'notifTab' + (tab === i ? ' active' : '')} onClick={() => setTab(i)}>
              {t.label}
            </button>
          ))}
        </div>

        {status === 'loading' && items.length === 0 ? (
          <div className="accSkelBlock" style={{ height: 300 }} />
        ) : status === 'error' && items.length === 0 ? (
          <div className="accEmpty">
            <p>Couldn't load your notifications right now.</p>
            <button type="button" className="blackButton" onClick={() => load(1, false)}>RETRY</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="notifPageEmpty">
            <Bell size={28} strokeWidth={1.3} />
            <p>You're all caught up.</p>
            <span>No new notifications right now.</span>
          </div>
        ) : (
          <>
            <div className="notifPageList">
              {filtered.map((n) => (
                <button type="button" key={n.id} className={'notifPageItem' + (n.isRead ? '' : ' unread')} onClick={() => openNotification(n)}>
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
              ))}
            </div>
            {items.length < total && (
              <button type="button" className="outlineButton" style={{ margin: '20px auto 0', display: 'block' }} disabled={status === 'loading'} onClick={loadMore}>
                {status === 'loading' ? 'Loading…' : 'LOAD MORE'}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default Notifications;
