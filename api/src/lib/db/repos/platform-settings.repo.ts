import { query, queryOne } from "../client";

/**
 * Platform branding settings — a single-row config (id = 1) driving the
 * site's customer-facing identity (name, logo, favicon, tagline, and now
 * the PWA app icon / install-prompt toggle — migration 0038 extended this
 * same table rather than creating a separate PWA settings table, since
 * it's the same kind of platform-identity configuration). The logo/
 * favicon/PWA icon are stored through the existing media pipeline (see
 * media.repo.ts) — this table only references them by id; the join below
 * resolves the actual URLs so callers never need a second round-trip.
 */

export type PlatformSettingsRow = {
  platform_name: string;
  tagline: string | null;
  logo_media_id: string | null;
  logo_url: string | null;
  favicon_media_id: string | null;
  favicon_url: string | null;
  pwa_icon_media_id: string | null;
  pwa_icon_url: string | null;
  pwa_icon_content_type: string | null;
  pwa_install_prompt_enabled: boolean;
  dar_es_salaam_fee_tzs: number;
  outside_dar_fee_tzs: number;
  cod_message: string | null;
  updated_at: string;
};

export type PlatformSettings = {
  platformName: string;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  pwaIconUrl: string | null;
  // Was previously assumed to always be PNG in the manifest route — a
  // real bug, since PWA icon uploads accept PNG/JPEG/WebP like any other
  // image upload (the same shared uploadMedia() path), so a non-PNG
  // upload silently produced a manifest with the wrong declared MIME
  // type, which browsers correctly refuse to use. Now carried through
  // explicitly so the manifest can declare the real type.
  pwaIconContentType: string | null;
  pwaInstallPromptEnabled: boolean;
  darEsSalaamFeeTzs: number;
  outsideDarFeeTzs: number;
  codMessage: string | null;
  updatedAt: string;
};

function toSettings(r: PlatformSettingsRow): PlatformSettings {
  return {
    platformName: r.platform_name,
    tagline: r.tagline,
    logoUrl: r.logo_url,
    faviconUrl: r.favicon_url,
    pwaIconUrl: r.pwa_icon_url,
    pwaIconContentType: r.pwa_icon_content_type,
    pwaInstallPromptEnabled: r.pwa_install_prompt_enabled,
    darEsSalaamFeeTzs: Number(r.dar_es_salaam_fee_tzs),
    outsideDarFeeTzs: Number(r.outside_dar_fee_tzs),
    codMessage: r.cod_message,
    updatedAt: r.updated_at,
  };
}

const SELECT_WITH_MEDIA = `
  SELECT
    ps.platform_name,
    ps.tagline,
    ps.logo_media_id,
    logo.url AS logo_url,
    ps.favicon_media_id,
    favicon.url AS favicon_url,
    ps.pwa_icon_media_id,
    pwa_icon.url AS pwa_icon_url,
    pwa_icon.content_type AS pwa_icon_content_type,
    ps.pwa_install_prompt_enabled,
    ps.dar_es_salaam_fee_tzs,
    ps.outside_dar_fee_tzs,
    ps.cod_message,
    ps.updated_at
  FROM platform_settings ps
  LEFT JOIN media logo ON logo.id = ps.logo_media_id
  LEFT JOIN media favicon ON favicon.id = ps.favicon_media_id
  LEFT JOIN media pwa_icon ON pwa_icon.id = ps.pwa_icon_media_id
  WHERE ps.id = 1
`;

/** Always returns a row — migration 0029 primes the singleton on creation, so this should never be null in practice, but callers should still treat 'PLUG' as the safe fallback if it somehow were. */
export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  const row = await queryOne<PlatformSettingsRow>(SELECT_WITH_MEDIA);
  return row ? toSettings(row) : null;
}

export async function updatePlatformName(name: string, actorId: string): Promise<PlatformSettings> {
  await query(
    `INSERT INTO platform_settings (id, platform_name, updated_by)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET platform_name = EXCLUDED.platform_name, updated_by = EXCLUDED.updated_by`,
    [name, actorId]
  );
  return (await getPlatformSettings())!;
}

export async function updateTagline(tagline: string | null, actorId: string): Promise<PlatformSettings> {
  await query(
    `INSERT INTO platform_settings (id, tagline, updated_by)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET tagline = EXCLUDED.tagline, updated_by = EXCLUDED.updated_by`,
    [tagline, actorId]
  );
  return (await getPlatformSettings())!;
}

export async function setLogoMedia(mediaId: string | null, actorId: string): Promise<PlatformSettings> {
  await query(
    `INSERT INTO platform_settings (id, logo_media_id, updated_by)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET logo_media_id = EXCLUDED.logo_media_id, updated_by = EXCLUDED.updated_by`,
    [mediaId, actorId]
  );
  return (await getPlatformSettings())!;
}

export async function setFaviconMedia(mediaId: string | null, actorId: string): Promise<PlatformSettings> {
  await query(
    `INSERT INTO platform_settings (id, favicon_media_id, updated_by)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET favicon_media_id = EXCLUDED.favicon_media_id, updated_by = EXCLUDED.updated_by`,
    [mediaId, actorId]
  );
  return (await getPlatformSettings())!;
}

export async function setPwaIconMedia(mediaId: string | null, actorId: string): Promise<PlatformSettings> {
  await query(
    `INSERT INTO platform_settings (id, pwa_icon_media_id, updated_by)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET pwa_icon_media_id = EXCLUDED.pwa_icon_media_id, updated_by = EXCLUDED.updated_by`,
    [mediaId, actorId]
  );
  return (await getPlatformSettings())!;
}

export async function setPwaInstallPromptEnabled(enabled: boolean, actorId: string): Promise<PlatformSettings> {
  await query(
    `INSERT INTO platform_settings (id, pwa_install_prompt_enabled, updated_by)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET pwa_install_prompt_enabled = EXCLUDED.pwa_install_prompt_enabled, updated_by = EXCLUDED.updated_by`,
    [enabled, actorId]
  );
  return (await getPlatformSettings())!;
}

export async function setDeliveryFees(darEsSalaamFeeTzs: number, outsideDarFeeTzs: number, actorId: string): Promise<PlatformSettings> {
  await query(
    `INSERT INTO platform_settings (id, dar_es_salaam_fee_tzs, outside_dar_fee_tzs, updated_by)
     VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       dar_es_salaam_fee_tzs = EXCLUDED.dar_es_salaam_fee_tzs,
       outside_dar_fee_tzs = EXCLUDED.outside_dar_fee_tzs,
       updated_by = EXCLUDED.updated_by`,
    [darEsSalaamFeeTzs, outsideDarFeeTzs, actorId]
  );
  return (await getPlatformSettings())!;
}

export async function setCodMessage(message: string | null, actorId: string): Promise<PlatformSettings> {
  await query(
    `INSERT INTO platform_settings (id, cod_message, updated_by)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET cod_message = EXCLUDED.cod_message, updated_by = EXCLUDED.updated_by`,
    [message, actorId]
  );
  return (await getPlatformSettings())!;
}
