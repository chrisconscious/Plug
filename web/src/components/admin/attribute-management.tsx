import { useState, useEffect, type CSSProperties } from 'react';
import * as api from '../../lib/api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { Plus, Trash2, ChevronDown, ChevronRight, ChevronUp, ChevronLeft, Pencil } from 'lucide-react';

export function AttributeManagement() {
  const [groups, setGroups] = useState<api.AttributeGroup[] | null>(null);
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  // Only the first load shows the full-page loading state; later reloads (after
  // an edit) refresh in place so the expanded group and its option editor stay
  // mounted. A failed reload keeps the last good list and says so.
  const load = (initial = false) => {
    if (initial) setStatus('loading');
    return Promise.all([api.listAdminAttributeGroups(), api.listAdminCategories()])
      .then(([g, c]) => { setGroups(g.groups); setCategories(c.categories); setStatus('success'); })
      .catch(() => { if (initial) setStatus('error'); else showBanner("Saved, but the list couldn't be refreshed — reload the page.", 'error'); });
  };
  useEffect(() => { void load(true); }, []);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const createGroup = useAsyncAction(async () => {
    if (!newGroupName.trim()) return;
    await api.createAttributeGroup({ name: newGroupName.trim() });
    setNewGroupName('');
    showBanner('Attribute group created.', 'ok');
    load();
  });

  const deleteGroup = useAsyncAction(async (id: string) => {
    await api.deleteAttributeGroup(id);
    showBanner('Attribute group deleted.', 'ok');
    load();
  });

  const toggleGroupActive = useAsyncAction(async (group: api.AttributeGroup) => {
    await api.updateAttributeGroup(group.id, { active: !group.active });
    load();
  });

  const renameGroup = useAsyncAction(async (group: api.AttributeGroup) => {
    const name = window.prompt('Rename attribute group', group.name)?.trim();
    if (!name || name === group.name) return;
    await api.updateAttributeGroup(group.id, { name });
    showBanner(`Renamed to "${name}".`, 'ok');
    await load();
  });

  // Groups are listed by display order; moving one renumbers the whole list so
  // ties (every new group starts at 0) can't make a move a no-op.
  const moveGroup = useAsyncAction(async (index: number, delta: -1 | 1) => {
    if (!groups) return;
    const order = [...groups];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    const changed = order.map((g, i) => ({ g, i })).filter(({ g, i }) => g.displayOrder !== i);
    for (const { g, i } of changed) await api.updateAttributeGroup(g.id, { displayOrder: i });
    await load();
  });

  const toggleCategory = useAsyncAction(async (group: api.AttributeGroup, categoryId: string) => {
    const current = group.categoryIds ?? [];
    const next = current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId];
    await api.updateAttributeGroup(group.id, { categoryIds: next });
    load();
  });

  if (status === 'loading') {
    return <div style={{ padding: 40, color: '#71717a', fontSize: 13 }}>Loading attribute groups…</div>;
  }
  if (status === 'error' || !groups) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load attribute groups.</p>
        <button className="blackButton" onClick={() => load(true)}>RETRY</button>
      </div>
    );
  }
  const groupError = toggleGroupActive.error ?? renameGroup.error ?? moveGroup.error ?? deleteGroup.error;

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ fontSize: 12.5, color: '#71717a', margin: 0 }}>
        Define category-specific characteristics (e.g. "Fit" for Jeans, "Neckline" for T-Shirts) and their options
        (e.g. "Slim", "Baggy"). Assign each group to whichever categories it applies to — a group can be shared
        across multiple categories. New options become available on the storefront immediately, with no code changes.
      </p>

      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="New attribute group name, e.g. Fit"
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14 }}
        />
        <button className="blackButton" disabled={createGroup.pending || !newGroupName.trim()} onClick={() => createGroup.run()}>
          <Plus size={14} /> {createGroup.pending ? 'Creating…' : 'Add Group'}
        </button>
      </div>
      {createGroup.error && <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{createGroup.error}</p>}
      {groupError && <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{groupError}</p>}

      {groups.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a3a3a3', padding: '20px 0' }}>No attribute groups yet — add one above.</p>
      ) : (
        groups.map((group, index) => (
          <div key={group.id} style={{ border: '1px solid #e5e5e5', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px' }}>
              <button type="button" aria-expanded={expanded === group.id} aria-label={`${expanded === group.id ? 'Collapse' : 'Expand'} ${group.name}`} onClick={() => setExpanded(expanded === group.id ? null : group.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555' }}>
                {expanded === group.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 14 }}>{group.name}</b>
                <div style={{ fontSize: 11, color: '#888' }}>
                  {group.selectionType === 'single_select' ? 'Single-select' : 'Multi-select'} · Applies to {group.categoryIds?.length ?? 0} categor{(group.categoryIds?.length ?? 0) === 1 ? 'y' : 'ies'}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" aria-label={`${group.name} active`} checked={group.active} onChange={() => toggleGroupActive.run(group)} disabled={toggleGroupActive.pending} />
                Active
              </label>
              <button type="button" title="Move group up" aria-label={`Move ${group.name} up`} disabled={index === 0 || moveGroup.pending} onClick={() => moveGroup.run(index, -1)} style={iconBtn}>
                <ChevronUp size={16} />
              </button>
              <button type="button" title="Move group down" aria-label={`Move ${group.name} down`} disabled={index === groups.length - 1 || moveGroup.pending} onClick={() => moveGroup.run(index, 1)} style={iconBtn}>
                <ChevronDown size={16} />
              </button>
              <button type="button" title="Rename group" aria-label={`Rename ${group.name}`} disabled={renameGroup.pending} onClick={() => renameGroup.run(group)} style={iconBtn}>
                <Pencil size={15} />
              </button>
              <button type="button" title="Delete group" aria-label={`Delete ${group.name}`} onClick={() => { if (confirm(`Delete "${group.name}"? This cannot be undone.`)) deleteGroup.run(group.id); }} disabled={deleteGroup.pending} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00' }}>
                <Trash2 size={16} />
              </button>
            </div>

            {expanded === group.id && (
              <div style={{ borderTop: '1px solid #f0f0f0', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 8 }}>Applies to categories</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {categories.map((c) => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
                        <input
                          type="checkbox"
                          checked={(group.categoryIds ?? []).includes(c.id)}
                          onChange={() => toggleCategory.run(group, c.id)}
                          disabled={toggleCategory.pending}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
                <OptionsEditor groupId={group.id} onChanged={load} />
                {toggleCategory.error && <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{toggleCategory.error}</p>}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function OptionsEditor({ groupId, onChanged }: { groupId: string; onChanged: () => void }) {
  const [options, setOptions] = useState<api.AttributeOption[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [newOptionName, setNewOptionName] = useState('');

  const load = (initial = false) => {
    if (initial) setStatus('loading');
    return api.listAttributeOptions(groupId)
      .then((r) => { setOptions(r.options); setStatus('success'); })
      .catch(() => setStatus('error'));
  };
  useEffect(() => { void load(true); }, [groupId]);

  const createOption = useAsyncAction(async () => {
    if (!newOptionName.trim()) return;
    await api.createAttributeOption(groupId, { name: newOptionName.trim() });
    setNewOptionName('');
    load();
    onChanged();
  });

  const deleteOption = useAsyncAction(async (id: string) => {
    await api.deleteAttributeOption(id);
    load();
    onChanged();
  });

  const toggleOptionActive = useAsyncAction(async (option: api.AttributeOption) => {
    await api.updateAttributeOption(option.id, { active: !option.active });
    await load();
  });

  const renameOption = useAsyncAction(async (option: api.AttributeOption) => {
    const name = window.prompt('Rename option', option.name)?.trim();
    if (!name || name === option.name) return;
    await api.updateAttributeOption(option.id, { name });
    await load();
    onChanged();
  });

  // Same renumbering approach as groups: new options all start at order 0.
  const moveOption = useAsyncAction(async (index: number, delta: -1 | 1) => {
    if (!options) return;
    const order = [...options];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    const changed = order.map((o, i) => ({ o, i })).filter(({ o, i }) => o.displayOrder !== i);
    for (const { o, i } of changed) await api.updateAttributeOption(o.id, { displayOrder: i });
    await load();
  });

  const optionError = createOption.error ?? deleteOption.error ?? toggleOptionActive.error ?? renameOption.error ?? moveOption.error;

  return (
    <div>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 8 }}>Options</span>
      {status === 'loading' && <p style={{ fontSize: 12, color: '#a3a3a3' }}>Loading options…</p>}
      {status === 'error' && (
        <div>
          <p style={{ color: '#c00', fontSize: 12, marginBottom: 6 }}>Couldn't load options.</p>
          <button className="blackButton" onClick={() => load(true)}>RETRY</button>
        </div>
      )}
      {status === 'success' && options && (
        <>
          {options.length === 0 ? (
            <p style={{ fontSize: 12, color: '#a3a3a3', marginBottom: 10 }}>No options yet.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {options.map((o, i) => (
                <span key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, border: `1px solid ${o.active ? '#d4d4d4' : '#f0f0f0'}`, fontSize: 12.5, opacity: o.active ? 1 : 0.5 }}>
                  <button type="button" title="Move option earlier" aria-label={`Move ${o.name} earlier`} disabled={i === 0 || moveOption.pending} onClick={() => moveOption.run(i, -1)} style={{ ...iconBtn, padding: 0, opacity: i === 0 ? 0.3 : 1 }}>
                    <ChevronLeft size={12} />
                  </button>
                  {o.name}
                  <button type="button" title="Move option later" aria-label={`Move ${o.name} later`} disabled={i === options.length - 1 || moveOption.pending} onClick={() => moveOption.run(i, 1)} style={{ ...iconBtn, padding: 0, opacity: i === options.length - 1 ? 0.3 : 1 }}>
                    <ChevronRight size={12} />
                  </button>
                  <button type="button" title="Rename option" aria-label={`Rename option ${o.name}`} disabled={renameOption.pending} onClick={() => renameOption.run(o)} style={{ ...iconBtn, padding: 0 }}>
                    <Pencil size={11} />
                  </button>
                  <button type="button" title={o.active ? 'Deactivate' : 'Activate'} aria-label={`${o.active ? 'Deactivate' : 'Activate'} option ${o.name}`} onClick={() => toggleOptionActive.run(o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#888' }}>
                    {o.active ? '●' : '○'}
                  </button>
                  <button type="button" title="Delete option" aria-label={`Delete option ${o.name}`} onClick={() => { if (confirm(`Delete option "${o.name}"?`)) deleteOption.run(o.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00', display: 'flex' }}>
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newOptionName}
              onChange={(e) => setNewOptionName(e.target.value)}
              placeholder="New option, e.g. Baggy"
              style={{ flex: 1, padding: '8px 10px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 13 }}
            />
            <button className="blackButton" disabled={createOption.pending || !newOptionName.trim()} onClick={() => createOption.run()}>
              {createOption.pending ? 'Adding…' : 'Add Option'}
            </button>
          </div>
          {optionError && <p role="alert" style={{ color: '#c00', fontSize: 12, marginTop: 6 }}>{optionError}</p>}
        </>
      )}
    </div>
  );
}

const iconBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#555', display: 'inline-flex', alignItems: 'center' };
