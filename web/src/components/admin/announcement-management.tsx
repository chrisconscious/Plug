import { useState, useEffect, type CSSProperties } from 'react';
import * as api from '../../lib/api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';

export function AnnouncementManagement() {
  const [items, setItems] = useState<api.Announcement[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [newMessage, setNewMessage] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Only the first load shows the loading state; reloads after an edit refresh
  // the list in place (no flash, focus and scroll kept).
  const load = (initial = false) => {
    if (initial) setStatus('loading');
    return api.listAdminAnnouncements()
      .then((r) => { setItems(r.announcements); setStatus('success'); })
      .catch(() => { if (initial) setStatus('error'); else showBanner("Saved, but the list couldn't be refreshed — reload the page.", 'error'); });
  };
  useEffect(() => { void load(true); }, []);

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
    await load();
  });

  const remove = useAsyncAction(async (id: string) => {
    await api.deleteAnnouncement(id);
    showBanner('Announcement removed.', 'ok');
    await load();
  });

  const toggleActive = useAsyncAction(async (item: api.Announcement) => {
    await api.updateAnnouncement(item.id, { active: !item.active });
    await load();
  });

  // Saved when the field loses focus. A blank or failed edit puts the saved
  // text back so the box never shows something the storefront doesn't.
  const editMessage = useAsyncAction(async (item: api.Announcement, input: HTMLInputElement) => {
    const message = input.value.trim();
    if (message === item.message) return;
    if (!message) {
      input.value = item.message;
      showBanner("An announcement can't be empty — use the bin to delete it.", 'error');
      return;
    }
    try {
      await api.updateAnnouncement(item.id, { message });
    } catch (e) {
      input.value = item.message;
      throw e;
    }
    showBanner('Announcement saved.', 'ok');
    await load();
  });

  const reorder = useAsyncAction(async (orderedIds: string[]) => {
    await api.reorderAnnouncements(orderedIds);
    await load();
  });
  // Buttons, not just drag-and-drop: HTML5 drag doesn't work on touch screens.
  const move = (index: number, delta: -1 | 1) => {
    if (!items) return;
    const ids = items.map((i) => i.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.run(ids);
  };

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
        <button className="blackButton" onClick={() => load(true)}>RETRY</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 12.5, color: '#71717a', margin: 0 }}>
        Messages shown in the header announcement bar, in order. Use the arrows (or drag) to reorder; edits save when you leave the field. Only active messages appear on the storefront.
      </p>

      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="New announcement"
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
          {items.map((item, index) => (
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
                key={item.message}
                aria-label={`Announcement ${index + 1} text`}
                defaultValue={item.message}
                maxLength={200}
                onBlur={(e) => editMessage.run(item, e.currentTarget)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                style={{ flex: 1, minWidth: 0, border: '1px solid transparent', borderBottomColor: '#e5e5e5', outline: 'none', fontSize: 13, background: 'transparent', padding: '4px 2px' }}
              />
              <button type="button" title="Move up" aria-label={`Move announcement ${index + 1} up`} disabled={index === 0 || reorder.pending} onClick={() => move(index, -1)} style={arrowBtn}><ChevronUp size={15} /></button>
              <button type="button" title="Move down" aria-label={`Move announcement ${index + 1} down`} disabled={index === items.length - 1 || reorder.pending} onClick={() => move(index, 1)} style={arrowBtn}><ChevronDown size={15} /></button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexShrink: 0 }}>
                <input type="checkbox" aria-label={`Announcement ${index + 1} active`} checked={item.active} onChange={() => toggleActive.run(item)} disabled={toggleActive.pending} />
                Active
              </label>
              <button
                type="button"
                title="Delete"
                aria-label={`Delete announcement ${index + 1}`}
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

const arrowBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#555', flexShrink: 0, display: 'flex', padding: 2 };
