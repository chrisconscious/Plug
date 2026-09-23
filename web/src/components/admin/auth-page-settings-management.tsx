import { useState, useEffect, useRef } from 'react';
import * as api from '../../lib/api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { Trash2, Upload } from 'lucide-react';

export function AuthPageSettingsManagement() {
  const [settings, setSettings] = useState<api.AuthPageSettings | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [loginHeadline, setLoginHeadline] = useState('');
  const [loginSubtitle, setLoginSubtitle] = useState('');
  const [registerHeadline, setRegisterHeadline] = useState('');
  const [registerSubtitle, setRegisterSubtitle] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setStatus('loading');
    api.getAdminAuthPageSettings()
      .then((r) => {
        const s = r.settings;
        setSettings(s);
        setLoginHeadline(s.loginHeadline);
        setLoginSubtitle(s.loginSubtitle);
        setRegisterHeadline(s.registerHeadline);
        setRegisterSubtitle(s.registerSubtitle);
        setStatus('success');
      })
      .catch(() => setStatus('error'));
  };
  useEffect(load, []);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const applyUpdate = (updated: api.AuthPageSettings) => {
    setSettings(updated);
    setLoginHeadline(updated.loginHeadline);
    setLoginSubtitle(updated.loginSubtitle);
    setRegisterHeadline(updated.registerHeadline);
    setRegisterSubtitle(updated.registerSubtitle);
  };

  const saveDetails = useAsyncAction(async () => {
    const updated = (await api.updateAuthPageSettings({ loginHeadline, loginSubtitle, registerHeadline, registerSubtitle })).settings;
    applyUpdate(updated);
    showBanner('Auth page content saved.', 'ok');
  });

  const uploadBg = useAsyncAction(async (file: File) => {
    const updated = (await api.uploadAuthPageBackground(file)).settings;
    applyUpdate(updated);
    showBanner('Background image uploaded.', 'ok');
  });

  const removeBg = useAsyncAction(async () => {
    const updated = (await api.removeAuthPageBackground()).settings;
    applyUpdate(updated);
    showBanner('Background image removed.', 'ok');
  });

  if (status === 'loading') {
    return <div style={{ padding: 40, color: '#71717a', fontSize: 13 }}>Loading auth page settings…</div>;
  }
  if (status === 'error' || !settings) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load auth page settings.</p>
        <button className="blackButton" onClick={load}>RETRY</button>
      </div>
    );
  }

  const hasBg = !!settings.backgroundImageUrl;

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 28 }}>
      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      {/* ---- Background image ---- */}
      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 4px' }}>Background image</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: '0 0 16px' }}>
          The image shown on the left side of the login/register page. Upload a large, high-quality photo (recommended: 800×1200px or taller). When no image is set, a dark gradient is shown instead.
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          <div style={{ width: 180, height: 260, border: '1px dashed #d4d4d4', borderRadius: 8, overflow: 'hidden', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {hasBg ? (
              <img src={api.assetUrl(settings.backgroundImageUrl!)} alt="Auth background preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', background: 'linear-gradient(155deg, #14161c 0%, #06070a 65%, #000 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: '#666', textAlign: 'center', padding: 12 }}>No image — gradient shown</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg.run(f); e.target.value = ''; }} />
            <button className="blackButton" disabled={uploadBg.pending || removeBg.pending} onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Upload size={14} /> {uploadBg.pending ? 'Uploading…' : hasBg ? 'Replace image' : 'Upload image'}
            </button>
            {hasBg && (
              <button
                type="button"
                disabled={removeBg.pending}
                onClick={() => { if (confirm('Remove the background image? The gradient will show instead.')) removeBg.run(); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid #e5e5e5', borderRadius: 6, padding: '8px 14px', fontSize: 13, color: '#b91c1c', cursor: 'pointer' }}
              >
                <Trash2 size={14} /> {removeBg.pending ? 'Removing…' : 'Remove image'}
              </button>
            )}
            {uploadBg.error && <p role="alert" style={{ color: '#c00', fontSize: 12 }}>{uploadBg.error}</p>}
          </div>
        </div>
      </section>

      {/* ---- Text fields ---- */}
      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 4px' }}>Headlines &amp; subtitles</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: '0 0 16px' }}>The text shown on the login/register page alongside the form. Both sets of fields are editable — when a user visits <code>/login</code> the "Login" fields are shown; on <code>/register</code> the "Register" ones.</p>

        <h4 style={{ font: '800 13px Manrope', margin: '0 0 10px', color: '#333' }}>Login page (/login)</h4>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Headline</label>
        <input value={loginHeadline} onChange={(e) => setLoginHeadline(e.target.value)} maxLength={200} style={{ width: '100%', padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14, marginBottom: 12 }} />
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Subtitle</label>
        <input value={loginSubtitle} onChange={(e) => setLoginSubtitle(e.target.value)} maxLength={200} style={{ width: '100%', padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14, marginBottom: 16 }} />

        <h4 style={{ font: '800 13px Manrope', margin: '0 0 10px', color: '#333' }}>Register page (/register)</h4>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Headline</label>
        <input value={registerHeadline} onChange={(e) => setRegisterHeadline(e.target.value)} maxLength={200} style={{ width: '100%', padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14, marginBottom: 12 }} />
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Subtitle</label>
        <input value={registerSubtitle} onChange={(e) => setRegisterSubtitle(e.target.value)} maxLength={200} style={{ width: '100%', padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14, marginBottom: 14 }} />

        {saveDetails.error && <p role="alert" style={{ color: '#c00', fontSize: 12, marginBottom: 10 }}>{saveDetails.error}</p>}
        <button className="blackButton" disabled={saveDetails.pending} onClick={() => saveDetails.run()}>
          {saveDetails.pending ? 'Saving…' : 'Save changes'}
        </button>
      </section>
    </div>
  );
}