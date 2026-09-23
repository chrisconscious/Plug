import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { Plus, Trash2, GripVertical } from 'lucide-react';

export function AnnouncementManagement() {
  const [items, setItems] = useState<api.Announcement[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [newMessage, setNewMessage] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = () => {
    setStatus('loading');
    api.listAdminAnnouncements()
      .then((r) => { setItems(r.announcements); setStatus('success'); })
      .catch(() => setStatus('error'));
  };
  useEffect(load, []);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const create = useAsyncAction(async () => {
    const text = newMessage.trim();
    if (!text) return;
    await api.createAnnouncement({ message: text });
    setNewMessage('');
    showBanner('Announcement created.', 'ok');
    load();
  });

  const remove = useAsyncAction(async (id: string) => {
    await api.deleteAnnouncement(id);
    showBanner('Announcement removed.', 'ok');
    load();
  });

  const toggleActive = useAsyncAction(async (item: api.Announcement) => {
    await api.updateAnnouncement(item.id, { active: !item.active });
    load();
  });

  const editMessage = useAsyncAction(async (item: api.Announcement, message: string) => {
    if (!message.trim() || message.trim() === item.message) return;
    await api.updateAnnouncement(item.id, { message: message.trim() });
    load();
  });

  const reorder = useAsyncAction(async (orderedIds: string[]) => {
    await api.reorderAnnouncements(orderedIds);
    load();
  });

  const onDrop = (targetId: string) => {
    if (!items || !dragId || dragId === targetId) { setDragId(null); return; }
    const current = items.map((i) => i.id);
    const from = current.indexOf(dragId);
    const to = current.indexOf(targetId);
    current.splice(to, 0, current.splice(from, 1)[0]);
    setDragId(null);
    reorder.run(current);
  };

  if (status === 'loading') {
    return <div style={{ padding: 40, color: '#71717a', fontSize: 13 }}>Loading announcements…</div>;
  }
  if (status === 'error' || !items) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load announcements.</p>
        <button className="blackButton" onClick={load}>RETRY</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 12.5, color: '#71717a', margin: 0 }}>
        Messages shown in the header announcement bar, in order. Drag to reorder. Only active messages appear on the storefront.
      </p>

      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="e.g. Complimentary delivery on selected orders"
          maxLength={200}
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14 }}
        />
        <button className="blackButton" disabled={create.pending || !newMessage.trim()} onClick={() => create.run()}>
          <Plus size={14} /> {create.pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {create.error && <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{create.error}</p>}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a3a3a3', padding: '20px 0' }}>No announcements yet — add one above. Until then, the header shows nothing.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(item.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e5e5e5', borderRadius: 8, padding: '10px 12px', opacity: item.active ? 1 : 0.55 }}
            >
              <GripVertical size={15} style={{ color: '#bbb', cursor: 'grab', flexShrink: 0 }} />
              <input
                defaultValue={item.message}
                maxLength={200}
                onBlur={(e) => editMessage.run(item, e.target.value)}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, background: 'transparent' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexShrink: 0 }}>
                <input type="checkbox" checked={item.active} onChange={() => toggleActive.run(item)} disabled={toggleActive.pending} />
                Active
              </label>
              <button
                type="button"
                title="Delete"
                onClick={() => { if (confirm('Remove this announcement?')) remove.run(item.id); }}
                disabled={remove.pending}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00', flexShrink: 0 }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {(remove.error || toggleActive.error || editMessage.error || reorder.error) && (
        <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{remove.error ?? toggleActive.error ?? editMessage.error ?? reorder.error}</p>
      )}
    </div>
  );
}
