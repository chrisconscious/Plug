import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { useAsyncAction } from '../../hooks/useAsyncAction';

const PLATFORM_LABELS: Record<api.FooterPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

const PLATFORM_PLACEHOLDERS: Record<api.FooterPlatform, string> = {
  instagram: 'https://instagram.com/yourbrand or @yourbrand',
  tiktok: 'https://tiktok.com/@yourbrand or @yourbrand',
  facebook: 'https://facebook.com/yourbrand or @yourbrand',
  phone: '0756825667',
  whatsapp: '0756825667 or https://wa.me/255756825667',
  email: 'hello@yourbrand.com',
};

export function FooterContactManagement() {
  const [links, setLinks] = useState<api.FooterContactLink[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  // `resetPlatform`: after saving one channel, only that channel's box is
  // reset to the stored value — unsaved text typed into the OTHER channels is
  // kept (a full reset used to wipe it). Only the first load shows "Loading…".
  const load = (initial = false, resetPlatform?: api.FooterPlatform) => {
    if (initial) setStatus('loading');
    return api.listAdminFooterContactLinks()
      .then((r) => {
        setLinks(r.links);
        setDrafts((cur) => Object.fromEntries(r.links.map((l) => [
          l.platform,
          initial || l.platform === resetPlatform || cur[l.platform] === undefined ? (l.value ?? '') : cur[l.platform],
        ])));
        setStatus('success');
      })
      .catch(() => { if (initial) setStatus('error'); else showBanner("Saved, but the list couldn't be refreshed — reload the page.", 'error'); });
  };
  useEffect(() => { void load(true); }, []);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const saveValue = useAsyncAction(async (link: api.FooterContactLink) => {
    const draft = (drafts[link.platform] ?? '').trim();
    await api.updateFooterContactLink(link.platform, { value: draft || null });
    showBanner(`${PLATFORM_LABELS[link.platform]} updated.`, 'ok');
    await load(false, link.platform);
  });

  const toggleActive = useAsyncAction(async (link: api.FooterContactLink) => {
    if (!link.active && !(link.value ?? '').trim()) {
      showBanner(`Enter a value for ${PLATFORM_LABELS[link.platform]} before activating it.`, 'error');
      return;
    }
    await api.updateFooterContactLink(link.platform, { active: !link.active });
    showBanner(`${PLATFORM_LABELS[link.platform]} ${link.active ? 'hidden from' : 'shown in'} the footer.`, 'ok');
    await load();
  });

  if (status === 'loading') {
    return <div style={{ padding: 40, color: '#71717a', fontSize: 13 }}>Loading footer contact links…</div>;
  }
  if (status === 'error' || !links) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load footer contact links.</p>
        <button className="blackButton" onClick={() => load(true)}>RETRY</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 12.5, color: '#71717a', margin: 0 }}>
        These six channels are the only ones the footer supports. A channel only appears on the site once it has a
        value AND is switched on — an empty or inactive channel never shows a dead icon to customers. Each value is
        checked when you save (a social link must point to that platform; numbers are Tanzanian mobiles) and the
        exact link customers will open is shown under it.
      </p>

      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {links.map((link) => {
          const draft = drafts[link.platform] ?? '';
          const dirty = draft.trim() !== (link.value ?? '');
          return (
            <div key={link.platform} style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: '14px 16px', opacity: link.active ? 1 : 0.75 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <b style={{ fontSize: 13.5 }}>{PLATFORM_LABELS[link.platform]}</b>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input type="checkbox" aria-label={`${PLATFORM_LABELS[link.platform]} active`} checked={link.active} onChange={() => toggleActive.run(link)} disabled={toggleActive.pending} />
                  Active
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  aria-label={`${PLATFORM_LABELS[link.platform]} link or number`}
                  value={draft}
                  onChange={(e) => setDrafts((cur) => ({ ...cur, [link.platform]: e.target.value }))}
                  placeholder={PLATFORM_PLACEHOLDERS[link.platform]}
                  style={{ flex: 1, padding: '9px 11px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 13 }}
                />
                <button className="blackButton" aria-label={`Save ${PLATFORM_LABELS[link.platform]}`} disabled={!dirty || saveValue.pending} onClick={() => saveValue.run(link)}>
                  {saveValue.pending ? 'Saving…' : 'Save'}
                </button>
              </div>
              {link.value && (
                <p data-role="contact-href" style={{ margin: '8px 0 0', fontSize: 11.5, color: link.href ? '#52525b' : '#b91c1c', wordBreak: 'break-all' }}>
                  {link.href
                    ? <>Customers open: <a href={link.href} target="_blank" rel="noopener noreferrer">{link.href}</a></>
                    : 'This saved value is not a valid link, so it is hidden from customers — re-enter it and save.'}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {(saveValue.error || toggleActive.error) && (
        <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{saveValue.error ?? toggleActive.error}</p>
      )}
    </div>
  );
}
