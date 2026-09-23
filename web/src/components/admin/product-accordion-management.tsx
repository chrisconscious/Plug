import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { Plus, Trash2, GripVertical, ChevronDown } from 'lucide-react';

export function ProductAccordionManagement() {
  const [items, setItems] = useState<api.AccordionSection[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    setStatus('loading');
    api.listAdminAccordionSections()
      .then((r) => { setItems(r.sections); setStatus('success'); })
      .catch(() => setStatus('error'));
  };
  useEffect(load, []);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const create = useAsyncAction(async () => {
    const title = newTitle.trim();
    const body = newBody.trim();
    if (!title || !body) return;
    await api.createAccordionSection({ title, body });
    setNewTitle('');
    setNewBody('');
    showBanner('Accordion section created.', 'ok');
    load();
  });

  const remove = useAsyncAction(async (id: string) => {
    await api.deleteAccordionSection(id);
    showBanner('Accordion section removed.', 'ok');
    load();
  });

  const toggleActive = useAsyncAction(async (item: api.AccordionSection) => {
    await api.updateAccordionSection(item.id, { active: !item.active });
    load();
  });

  const editField = useAsyncAction(async (item: api.AccordionSection, patch: Partial<{ title: string; body: string }>) => {
    const field = 'title' in patch ? 'title' : 'body';
    const value = (patch as Record<string, string>)[field].trim();
    if (!value || value === item[field]) return;
    await api.updateAccordionSection(item.id, { [field]: value } as Partial<{ title: string; body: string }>);
    load();
  });

  const reorder = useAsyncAction(async (orderedIds: string[]) => {
    await api.reorderAccordionSections(orderedIds);
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
    return <div style={{ padding: 40, color: '#71717a', fontSize: 13 }}>Loading accordion sections…</div>;
  }
  if (status === 'error' || !items) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load accordion sections.</p>
        <button className="blackButton" onClick={load}>RETRY</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 12.5, color: '#71717a', margin: 0 }}>
        These expandable sections appear on EVERY product page, in order. Title = the name shown on the page (e.g. DESCRIPTION), Body = what visitors read when they expand it. Drag to reorder; only active sections show on the storefront.
      </p>

      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #e5e5e5', borderRadius: 8, padding: 12 }}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Title e.g. SIZE & FIT"
          maxLength={120}
          style={{ padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14 }}
        />
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Body text — what shoppers read when they tap to expand this section…"
          maxLength={10000}
          rows={4}
          style={{ padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="blackButton" disabled={create.pending || !newTitle.trim() || !newBody.trim()} onClick={() => create.run()}>
            <Plus size={14} /> {create.pending ? 'Adding…' : 'Add section'}
          </button>
        </div>
      </div>
      {create.error && <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{create.error}</p>}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a3a3a3', padding: '20px 0' }}>No accordion sections yet — add one above. Until then, product pages show no accordion.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(item.id)}
              style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: '10px 12px', opacity: item.active ? 1 : 0.55 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <GripVertical size={15} style={{ color: '#bbb', cursor: 'grab', flexShrink: 0 }} />
                <input
                  defaultValue={item.title}
                  maxLength={120}
                  onBlur={(e) => editField.run(item, { title: e.target.value })}
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, fontWeight: 700, background: 'transparent' }}
                />
                <button
                  type="button"
                  title={expanded === item.id ? 'Collapse' : 'Edit body'}
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52525b', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                >
                  <ChevronDown size={16} style={{ transform: expanded === item.id ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexShrink: 0 }}>
                  <input type="checkbox" checked={item.active} onChange={() => toggleActive.run(item)} disabled={toggleActive.pending} />
                  Active
                </label>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => { if (confirm('Remove this accordion section?')) remove.run(item.id); }}
                  disabled={remove.pending}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00', flexShrink: 0 }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {expanded === item.id && (
                <textarea
                  defaultValue={item.body}
                  maxLength={10000}
                  rows={5}
                  onBlur={(e) => editField.run(item, { body: e.target.value })}
                  style={{ display: 'block', width: '100%', marginTop: 8, padding: '10px 12px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {(remove.error || toggleActive.error || editField.error || reorder.error) && (
        <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{remove.error ?? toggleActive.error ?? editField.error ?? reorder.error}</p>
      )}
    </div>
  );
}