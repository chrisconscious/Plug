import { useState, useEffect, type CSSProperties } from 'react';
import * as api from '../../lib/api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp } from 'lucide-react';

export function ProductAccordionManagement() {
  const [items, setItems] = useState<api.AccordionSection[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Only the first load shows the loading state; reloads after an edit refresh
  // the list in place (no flash, the open section stays open).
  const load = (initial = false) => {
    if (initial) setStatus('loading');
    return api.listAdminAccordionSections()
      .then((r) => { setItems(r.sections); setStatus('success'); })
      .catch(() => { if (initial) setStatus('error'); else showBanner("Saved, but the list couldn't be refreshed — reload the page.", 'error'); });
  };
  useEffect(() => { void load(true); }, []);

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
    await load();
  });

  const remove = useAsyncAction(async (id: string) => {
    await api.deleteAccordionSection(id);
    showBanner('Accordion section removed.', 'ok');
    await load();
  });

  const toggleActive = useAsyncAction(async (item: api.AccordionSection) => {
    await api.updateAccordionSection(item.id, { active: !item.active });
    await load();
  });

  // Saved when the field loses focus. A blank or failed edit puts the saved
  // text back so the box never shows something product pages don't.
  const editField = useAsyncAction(async (item: api.AccordionSection, field: 'title' | 'body', input: HTMLInputElement | HTMLTextAreaElement) => {
    const value = input.value.trim();
    if (value === item[field]) return;
    if (!value) {
      input.value = item[field];
      showBanner(`The ${field} can't be empty — use the bin to delete the section.`, 'error');
      return;
    }
    try {
      await api.updateAccordionSection(item.id, { [field]: value });
    } catch (e) {
      input.value = item[field];
      throw e;
    }
    showBanner(`Section ${field} saved.`, 'ok');
    await load();
  });

  const reorder = useAsyncAction(async (orderedIds: string[]) => {
    await api.reorderAccordionSections(orderedIds);
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
    return <div style={{ padding: 40, color: '#71717a', fontSize: 13 }}>Loading accordion sections…</div>;
  }
  if (status === 'error' || !items) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load accordion sections.</p>
        <button className="blackButton" onClick={() => load(true)}>RETRY</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 12.5, color: '#71717a', margin: 0 }}>
        These expandable sections appear on EVERY product page, in order. Title = the name shown on the page (e.g. DESCRIPTION), Body = what visitors read when they expand it. Use the arrows (or drag) to reorder; edits save when you leave the field. Only active sections show on the storefront.
      </p>

      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #e5e5e5', borderRadius: 8, padding: 12 }}>
        <input
          aria-label="New section title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Title e.g. SIZE & FIT"
          maxLength={120}
          style={{ padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14 }}
        />
        <textarea
          aria-label="New section body"
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
          {items.map((item, index) => (
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
                  key={item.title}
                  aria-label={`Section ${index + 1} title`}
                  defaultValue={item.title}
                  maxLength={120}
                  onBlur={(e) => editField.run(item, 'title', e.currentTarget)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  style={{ flex: 1, minWidth: 0, border: '1px solid transparent', borderBottomColor: '#e5e5e5', outline: 'none', fontSize: 13, fontWeight: 700, background: 'transparent', padding: '4px 2px' }}
                />
                <button type="button" title="Move up" aria-label={`Move ${item.title} up`} disabled={index === 0 || reorder.pending} onClick={() => move(index, -1)} style={arrowBtn}><ChevronUp size={15} /></button>
                <button type="button" title="Move down" aria-label={`Move ${item.title} down`} disabled={index === items.length - 1 || reorder.pending} onClick={() => move(index, 1)} style={arrowBtn}><ChevronDown size={15} /></button>
                <button
                  type="button"
                  title={expanded === item.id ? 'Collapse' : 'Edit body'}
                  aria-label={`${expanded === item.id ? 'Collapse' : 'Edit body of'} ${item.title}`}
                  aria-expanded={expanded === item.id}
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52525b', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                >
                  <ChevronDown size={16} style={{ transform: expanded === item.id ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexShrink: 0 }}>
                  <input type="checkbox" aria-label={`${item.title} active`} checked={item.active} onChange={() => toggleActive.run(item)} disabled={toggleActive.pending} />
                  Active
                </label>
                <button
                  type="button"
                  title="Delete"
                  aria-label={`Delete ${item.title}`}
                  onClick={() => { if (confirm('Remove this accordion section?')) remove.run(item.id); }}
                  disabled={remove.pending}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00', flexShrink: 0 }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {expanded === item.id && (
                <textarea
                  key={item.body}
                  aria-label={`Body of ${item.title}`}
                  defaultValue={item.body}
                  maxLength={10000}
                  rows={5}
                  onBlur={(e) => editField.run(item, 'body', e.currentTarget)}
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
const arrowBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#555', flexShrink: 0, display: 'flex', padding: 2 };
