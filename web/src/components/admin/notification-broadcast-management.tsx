import { useState, useEffect } from 'react';
import * as api from '../../lib/api';

const ROLE_LABEL: Record<string, string> = {
  CUSTOMER: 'Customers',
  ADMIN: 'Admins',
  SUPER_ADMIN: 'Super Admins',
};

export function NotificationBroadcastManagement() {
  const [items, setItems] = useState<api.AdminBroadcastNotification[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const [roleScope, setRoleScope] = useState<'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN'>('CUSTOMER');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [sending, setSending] = useState(false);

  const load = () => {
    setStatus('loading');
    api.listAdminBroadcasts()
      .then((r) => { setItems(r.notifications); setStatus('success'); })
      .catch(() => setStatus('error'));
  };
  useEffect(load, []);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!title.trim() || !message.trim()) {
      showBanner('Enter a title and a message before sending.', 'error');
      return;
    }
    setSending(true);
    try {
      await api.createBroadcastNotification({ roleScope, title: title.trim(), message: message.trim(), actionUrl: actionUrl.trim() || undefined });
      setTitle('');
      setMessage('');
      setActionUrl('');
      showBanner('Notification sent.', 'ok');
      load();
    } catch (e) {
      showBanner(e instanceof api.ApiError ? e.message : 'Could not send this notification.', 'error');
    } finally {
      setSending(false);
    }
  };

  const toggleActive = async (n: api.AdminBroadcastNotification) => {
    try {
      await api.setBroadcastNotificationActive(n.id, !n.active);
      load();
    } catch (e) {
      showBanner(e instanceof api.ApiError ? e.message : 'Could not update this notification.', 'error');
    }
  };

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 4px' }}>Send a Notification</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: '0 0 16px' }}>
          Sent instantly to every user currently holding the selected role — visible in their notification bell and notification center.
        </p>
        <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Audience</label>
            <select value={roleScope} onChange={(e) => setRoleScope(e.target.value as typeof roleScope)} style={{ padding: '9px 10px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 13, width: 220 }}>
              <option value="CUSTOMER">Customers</option>
              <option value="ADMIN">Admins</option>
              <option value="SUPER_ADMIN">Super Admins</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="NEW SEASON HAS ARRIVED" style={{ width: '100%', padding: '9px 11px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Message</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} placeholder="Explore the latest PLUG collection." style={{ width: '100%', padding: '9px 11px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 13, minHeight: 64, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>
              Link <small style={{ fontWeight: 400, color: '#999' }}>(optional — where tapping the notification takes the user, e.g. /shop?collection=new-season)</small>
            </label>
            <input value={actionUrl} onChange={(e) => setActionUrl(e.target.value)} placeholder="/shop" style={{ width: '100%', padding: '9px 11px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 13 }} />
          </div>
          <button type="submit" className="blackButton" disabled={sending} style={{ alignSelf: 'flex-start' }}>
            {sending ? 'Sending…' : 'SEND NOTIFICATION'}
          </button>
        </form>
      </section>

      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 14px' }}>Sent Notifications</h3>
        {status === 'loading' ? (
          <div style={{ color: '#71717a', fontSize: 13 }}>Loading…</div>
        ) : status === 'error' ? (
          <div>
            <p style={{ color: '#c00', marginBottom: 10, fontSize: 13 }}>Couldn't load sent notifications.</p>
            <button type="button" className="blackButton" onClick={load}>RETRY</button>
          </div>
        ) : !items || items.length === 0 ? (
          <p style={{ fontSize: 13, color: '#888' }}>No broadcast notifications have been sent yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((n) => (
              <div key={n.id} style={{ border: '1px solid #ece9e2', borderRadius: 8, padding: '12px 14px', opacity: n.active ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <b style={{ fontSize: 13 }}>{n.title}</b>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#888', letterSpacing: '.04em' }}>{ROLE_LABEL[n.roleScope]}</span>
                </div>
                <p style={{ fontSize: 12.5, color: '#666', margin: '0 0 8px' }}>{n.message}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: '#999' }}>{new Date(n.createdAt).toLocaleString()}</span>
                  <button type="button" onClick={() => toggleActive(n)} style={{ fontSize: 11, fontWeight: 700, background: 'none', border: 'none', color: n.active ? '#b91c1c' : '#166534', cursor: 'pointer' }}>
                    {n.active ? 'DEACTIVATE' : 'ACTIVATE'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
