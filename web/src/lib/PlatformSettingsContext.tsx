import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from './api';

interface PlatformSettingsContextValue {
  platformName: string;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  pwaIconUrl: string | null;
  pwaInstallPromptEnabled: boolean;
  darEsSalaamFeeTzs: number;
  outsideDarFeeTzs: number;
  codMessage: string | null;
  loading: boolean;
  /** Re-fetches after a Super Admin changes branding, so the change reflects without a full page reload. */
  refresh: () => Promise<void>;
}

const FALLBACK_NAME = 'PLUG';

const PlatformSettingsContext = createContext<PlatformSettingsContextValue>({
  platformName: FALLBACK_NAME,
  tagline: null,
  logoUrl: null,
  faviconUrl: null,
  pwaIconUrl: null,
  pwaInstallPromptEnabled: true,
  darEsSalaamFeeTzs: 0,
  outsideDarFeeTzs: 0,
  codMessage: null,
  loading: true,
  refresh: async () => {},
});

export function PlatformSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<api.PlatformSettings>({
    platformName: FALLBACK_NAME,
    tagline: null,
    logoUrl: null,
    faviconUrl: null,
    pwaIconUrl: null,
    pwaInstallPromptEnabled: true,
    darEsSalaamFeeTzs: 0,
    outsideDarFeeTzs: 0,
    codMessage: null,
    updatedAt: '',
  });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.getPlatformSettings();
      setSettings(r.settings);
    } catch {
      // Network/server failure — keep the safe PLUG-text fallback rather
      // than show a broken/blank header. This is a branding read, not a
      // security-sensitive one, so a silent fallback here (unlike the
      // error-vs-empty distinctions built elsewhere in this app) is the
      // right call: worst case the page shows generic text branding
      // instead of the uploaded logo, not broken functionality.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Keep the browser tab title and favicon in sync with the configured
  // identity — this is what makes "change it once in Super Admin, it
  // updates everywhere" true for the two things a static index.html
  // cannot express dynamically on its own.
  useEffect(() => {
    if (settings.platformName) {
      document.title = settings.platformName;
    }
    if (settings.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = api.assetUrl(settings.faviconUrl) ?? settings.faviconUrl;
    }
  }, [settings.platformName, settings.faviconUrl]);

  return (
    <PlatformSettingsContext.Provider value={{ ...settings, loading, refresh: load }}>
      {children}
    </PlatformSettingsContext.Provider>
  );
}

export function usePlatformSettings() {
  return useContext(PlatformSettingsContext);
}
