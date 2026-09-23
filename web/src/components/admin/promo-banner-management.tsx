import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { Plus, Trash2, GripVertical } from 'lucide-react';

export function PromoBannerManagement() {
  const [items, setItems] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [newMessage, setNewMessage] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const load = () => {
    setStatus('loading');
    api.getAdminPromoBanner()
      .then((r) => { setItems(r.messages); setStatus('success'); setDirty(false); })
      .catch(() => setStatus('error'));
  };
  useEffect(load, []);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const save = useAsyncAction(async (msgs: string[]) => {
    await api.updateAdminPromoBanner(msgs);
    setItems(msgs);
    setDirty(false);
    showBanner('Promo banner updated.', 'ok');
  });

  const addMessage = () => {
    const text = newMessage.trim();
    if (!text || items.length >= 10) return;
    const next = [...items, text];
    setNewMessage('');
    save.run(next);
  };

  const removeMessage = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    save.run(next);
  };

  const editMessage = (idx: number, value: string) => {
    const next = items.map((m, i) => (i === idx ? value : m));
    setItems(next);
    setDirty(true);
  };

  const onDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return; }
    const next = [...items];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    setDragIdx(null);
    save.run(next);
  };

  if (status === 'loading') {
    return <div style={{ padding: 40, color: '#71717a', fontSize: 13 }}>Loading promo banner…</div>;
  }
  if (status === 'error') {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load promo banner.</p>
        <button className="blackButton" onClick={load}>RETRY</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 12.5, color: '#71717a', margin: 0 }}>
        Messages shown in the beige strip below the header (delivery / returns / campaign copy). Maximum 10 messages.
        Changes only take effect after pressing <strong>Save</strong>.
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
          placeholder="e.g. COMPLIMENTARY DELIVERY ON SELECTED ORDERS"
          maxLength={200}
          disabled={items.length >= 10}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMessage(); } }}
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14 }}
        />
        <button className="blackButton" disabled={!newMessage.trim() || items.length >= 10 || save.pending} onClick={addMessage}>
          <Plus size={14} /> Add
        </button>
      </div>
      {items.length >= 10 && <p style={{ fontSize: 11, color: '#a3a3a3', margin: 0 }}>Maximum of 10 messages reached — remove one before adding another.</p>}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a3a3a3', padding: '20px 0' }}>No messages configured — add one above.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((msg, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e5e5e5', borderRadius: 8, padding: '10px 12px' }}
            >
              <GripVertical size={15} style={{ color: '#bbb', cursor: 'grab', flexShrink: 0 }} />
              <input
                value={msg}
                maxLength={200}
                onChange={(e) => editMessage(i, e.target.value)}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, background: 'transparent' }}
              />
              <button
                type="button"
                title="Remove"
                onClick={() => removeMessage(i)}
                disabled={save.pending}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00', flexShrink: 0 }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {dirty && (
        <button
          className="blackButton"
          disabled={save.pending}
          onClick={() => save.run([...items])}
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
        >
          {save.pending ? 'Saving…' : 'Save changes'}
        </button>
      )}
      {save.error && <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{save.error}</p>}
    </div>
  );
}
