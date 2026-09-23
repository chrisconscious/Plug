import { useState, useEffect, useRef } from 'react';
import * as api from '../../lib/api';
import { usePlatformSettings } from '../../lib/PlatformSettingsContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { Upload, Trash2, RefreshCw } from 'lucide-react';

/**
 * Superadmin-only (route-gated by permission: "content.manage" on the
 * backend — see admin/platform-settings/*.route.ts). Everything here
 * writes through platform-settings.service.ts, which itself writes
 * through the SAME media pipeline every other image upload in this app
 * uses — no second storage/validation system was created for this.
 */
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // mirrors UPLOAD_MAX_BYTES default in api/src/lib/config.ts

/** Mirrors the backend's media-service validation (api/src/lib/security/image.ts) so a rejected file is caught in the browser, not after a failed upload round-trip. Returns an error message, or null when the file is acceptable. */
function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "Unsupported file type. Choose a PNG, JPEG, or WebP image — vector formats like SVG aren't accepted because they can carry scripts.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "File is too large. Maximum size is 8 MB.";
  }
  return null;
}

export function PlatformBrandingSettings() {
  const { refresh: refreshGlobalSettings } = usePlatformSettings();
  const [settings, setSettings] = useState<api.PlatformSettings | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const pwaIconInputRef = useRef<HTMLInputElement>(null);
  const [logoPreviewBroken, setLogoPreviewBroken] = useState(false);

  const load = () => {
    setStatus('loading');
    api.getPlatformSettings()
      .then((r) => {
        setSettings(r.settings);
        setName(r.settings.platformName);
        setTagline(r.settings.tagline ?? '');
        setStatus('success');
      })
      .catch(() => setStatus('error'));
  };
  useEffect(load, []);

  // Reset the broken-preview flag whenever a (possibly different) logo URL
  // arrives, so a failed image can re-try instead of being stuck invisible.
  useEffect(() => setLogoPreviewBroken(false), [settings?.logoUrl]);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const applyUpdate = (updated: api.PlatformSettings) => {
    setSettings(updated);
    refreshGlobalSettings(); // so the header/footer/everywhere else picks up the change immediately, without a page reload
  };

  const saveDetails = useAsyncAction(async () => {
    const updated = (await api.updatePlatformSettings({ platformName: name, tagline: tagline || null })).settings;
    applyUpdate(updated);
    showBanner('Platform details saved.', 'ok');
  });

  const uploadLogo = useAsyncAction(async (file: File) => {
    const updated = (await api.uploadPlatformLogo(file)).settings;
    applyUpdate(updated);
    showBanner('Logo updated.', 'ok');
  });

  const removeLogo = useAsyncAction(async () => {
    const updated = (await api.removePlatformLogo()).settings;
    applyUpdate(updated);
    showBanner('Logo removed — the text fallback will show until a new one is uploaded.', 'ok');
  });

  const uploadFavicon = useAsyncAction(async (file: File) => {
    const updated = (await api.uploadPlatformFavicon(file)).settings;
    applyUpdate(updated);
    showBanner('Favicon updated.', 'ok');
  });

  const removeFavicon = useAsyncAction(async () => {
    const updated = (await api.removePlatformFavicon()).settings;
    applyUpdate(updated);
    showBanner('Favicon removed.', 'ok');
  });

  const uploadPwaIcon = useAsyncAction(async (file: File) => {
    const updated = (await api.uploadPlatformPwaIcon(file)).settings;
    applyUpdate(updated);
    showBanner('App icon updated.', 'ok');
  });

  const removePwaIcon = useAsyncAction(async () => {
    const updated = (await api.removePlatformPwaIcon()).settings;
    applyUpdate(updated);
    showBanner('App icon removed.', 'ok');
  });

  const toggleInstallPrompt = useAsyncAction(async (enabled: boolean) => {
    const updated = (await api.updatePlatformSettings({ pwaInstallPromptEnabled: enabled })).settings;
    applyUpdate(updated);
    showBanner(enabled ? 'Install prompt enabled.' : 'Install prompt disabled.', 'ok');
  });

  if (status === 'loading') {
    return <div style={{ padding: 40, color: '#71717a', fontSize: 13 }}>Loading platform branding…</div>;
  }
  if (status === 'error' || !settings) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load platform branding settings.</p>
        <button className="blackButton" onClick={load}>RETRY</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 28 }}>
      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      {/* ---- Platform name & tagline ---- */}
      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 4px' }}>Platform identity</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: '0 0 16px' }}>Shown across the entire storefront — header, footer, browser tab, and every customer-facing page.</p>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Platform name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} style={{ width: '100%', padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14, marginBottom: 14 }} />
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Tagline (optional)</label>
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={140} placeholder="e.g. Style, plugged in." style={{ width: '100%', padding: '10px 12px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14, marginBottom: 14 }} />
        {saveDetails.error && <p role="alert" style={{ color: '#c00', fontSize: 12, marginBottom: 10 }}>{saveDetails.error}</p>}
        <button className="blackButton" disabled={saveDetails.pending} onClick={() => saveDetails.run()}>
          {saveDetails.pending ? 'Saving…' : 'Save changes'}
        </button>
      </section>

      {/* ---- Logo ---- */}
      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 4px' }}>Brand logo / wordmark</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: '0 0 16px' }}>
          The SAME wordmark is shown at the top of the storeframe (light header) and at the bottom of the footer (dark
          footer), scaled responsively per screen but never stretched or cropped. Upload a transparent-background logo
          that reads clearly on both light and dark. PNG, JPEG, or WEBP; until a logo is uploaded the platform name is
          shown as text instead.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 160, height: 64, border: '1px dashed #d4d4d4', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', overflow: 'hidden' }}>
            {settings.logoUrl && !logoPreviewBroken ? (
              <img src={api.assetUrl(settings.logoUrl)} alt="Current platform logo" style={{ maxHeight: '80%', maxWidth: '90%', objectFit: 'contain' }} onError={() => setLogoPreviewBroken(true)} />
            ) : (
              <span style={{ fontSize: 11, color: '#a3a3a3' }}>No logo uploaded</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="blackButton"
              disabled={uploadLogo.pending}
              onClick={() => logoInputRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Upload size={14} /> {uploadLogo.pending ? 'Uploading…' : settings.logoUrl ? 'Replace logo' : 'Upload logo'}
            </button>
            {settings.logoUrl && (
              <button type="button" onClick={() => removeLogo.run()} disabled={removeLogo.pending} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}>
                <Trash2 size={14} /> {removeLogo.pending ? 'Removing…' : 'Remove logo'}
              </button>
            )}
          </div>
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { const err = validateImageFile(f); if (err) showBanner(err, 'error'); else uploadLogo.run(f); } e.target.value = ''; }}
        />
        {(uploadLogo.error || removeLogo.error) && <p role="alert" style={{ color: '#c00', fontSize: 12, marginTop: 10 }}>{uploadLogo.error ?? removeLogo.error}</p>}
      </section>

      {/* ---- Favicon ---- */}
      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 4px' }}>Favicon</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: '0 0 16px' }}>The small icon shown in browser tabs. PNG, JPEG, or WEBP, ideally square.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 48, height: 48, border: '1px dashed #d4d4d4', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', overflow: 'hidden' }}>
            {settings.faviconUrl ? (
              <img src={api.assetUrl(settings.faviconUrl)} alt="Current favicon" style={{ maxHeight: '90%', maxWidth: '90%', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 9, color: '#a3a3a3', textAlign: 'center' }}>None</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" className="blackButton" disabled={uploadFavicon.pending} onClick={() => faviconInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Upload size={14} /> {uploadFavicon.pending ? 'Uploading…' : settings.faviconUrl ? 'Replace favicon' : 'Upload favicon'}
            </button>
            {settings.faviconUrl && (
              <button type="button" onClick={() => removeFavicon.run()} disabled={removeFavicon.pending} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}>
                <Trash2 size={14} /> {removeFavicon.pending ? 'Removing…' : 'Remove favicon'}
              </button>
            )}
          </div>
        </div>
        <input
          ref={faviconInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { const err = validateImageFile(f); if (err) showBanner(err, 'error'); else uploadFavicon.run(f); } e.target.value = ''; }}
        />
        {(uploadFavicon.error || removeFavicon.error) && <p role="alert" style={{ color: '#c00', fontSize: 12, marginTop: 10 }}>{uploadFavicon.error ?? removeFavicon.error}</p>}
      </section>

      {/* ---- PWA / App Experience ---- */}
      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 4px' }}>PWA / App Experience</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: '0 0 16px' }}>
          The icon shown when a customer installs {settings.platformName} to their phone or desktop, and whether the install card appears at all.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 18 }}>
          <div style={{ width: 56, height: 56, border: '1px dashed #d4d4d4', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', overflow: 'hidden' }}>
            {settings.pwaIconUrl ? (
              <img src={api.assetUrl(settings.pwaIconUrl)} alt="Current app icon" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 9, color: '#a3a3a3', textAlign: 'center' }}>None<br />(falls back to logo)</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" className="blackButton" disabled={uploadPwaIcon.pending} onClick={() => pwaIconInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Upload size={14} /> {uploadPwaIcon.pending ? 'Uploading…' : settings.pwaIconUrl ? 'Replace app icon' : 'Upload app icon'}
            </button>
            {settings.pwaIconUrl && (
              <button type="button" onClick={() => removePwaIcon.run()} disabled={removePwaIcon.pending} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}>
                <Trash2 size={14} /> {removePwaIcon.pending ? 'Removing…' : 'Remove app icon'}
              </button>
            )}
          </div>
        </div>
        <input
          ref={pwaIconInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { const err = validateImageFile(f); if (err) showBanner(err, 'error'); else uploadPwaIcon.run(f); } e.target.value = ''; }}
        />
        {(uploadPwaIcon.error || removePwaIcon.error) && <p role="alert" style={{ color: '#c00', fontSize: 12, marginBottom: 14 }}>{uploadPwaIcon.error ?? removePwaIcon.error}</p>}

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, borderTop: '1px solid #f0f0f0', paddingTop: 14 }}>
          <input
            type="checkbox"
            checked={settings.pwaInstallPromptEnabled}
            disabled={toggleInstallPrompt.pending}
            onChange={(e) => toggleInstallPrompt.run(e.target.checked)}
          />
          Show install prompt to eligible customers
        </label>
        {toggleInstallPrompt.error && <p role="alert" style={{ color: '#c00', fontSize: 12, marginTop: 8 }}>{toggleInstallPrompt.error}</p>}
      </section>

      <button type="button" onClick={load} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer' }}>
        <RefreshCw size={12} /> Refresh
      </button>
    </div>
  );
}
