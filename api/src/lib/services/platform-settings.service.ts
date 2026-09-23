import * as platformSettingsRepo from "../db/repos/platform-settings.repo";
import * as mediaService from "./media.service";
import type { StorageProvider } from "../storage/provider";
import { ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { Role } from "../rbac";

/**
 * Platform branding — deliberately thin. All actual upload/validation/
 * storage/deletion logic lives in media.service.ts (the same pipeline
 * every other image in this app goes through: magic-byte content
 * inspection, dimension/size limits, EXIF stripping, checksum dedup).
 * This module only orchestrates "which media row is the current logo/
 * favicon/PWA icon" and audit-logs the change — it does not duplicate
 * any of that logic.
 */

export async function getPlatformSettings() {
  const settings = await platformSettingsRepo.getPlatformSettings();
  // Should never actually be null (migration 0029 primes the singleton),
  // but a safe fallback is one honest guard away rather than a thrown 500
  // if that invariant is ever violated by a manual DB edit.
  return settings ?? { platformName: "PLUG", tagline: null, logoUrl: null, faviconUrl: null, pwaIconUrl: null, pwaIconContentType: null, pwaInstallPromptEnabled: true, darEsSalaamFeeTzs: 0, outsideDarFeeTzs: 0, codMessage: null, updatedAt: new Date().toISOString() };
}

export async function updatePlatformName(actor: { id: string; role: Role }, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Validation failed.", { platformName: "Platform name cannot be blank." });
  if (trimmed.length > 60) throw new ValidationError("Validation failed.", { platformName: "Platform name must be 60 characters or fewer." });
  const result = await platformSettingsRepo.updatePlatformName(trimmed, actor.id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "platform_settings.name_changed", targetType: "platform_settings", targetId: "1", metadata: { name: trimmed } });
  return result;
}

export async function updateTagline(actor: { id: string; role: Role }, tagline: string | null) {
  const trimmed = tagline?.trim() || null;
  if (trimmed && trimmed.length > 140) throw new ValidationError("Validation failed.", { tagline: "Tagline must be 140 characters or fewer." });
  const result = await platformSettingsRepo.updateTagline(trimmed, actor.id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "platform_settings.tagline_changed", targetType: "platform_settings", targetId: "1" });
  return result;
}

type BrandingAssetKind = "logo" | "favicon" | "pwa_icon";

const ASSET_COLUMN: Record<BrandingAssetKind, string> = {
  logo: "logo_media_id",
  favicon: "favicon_media_id",
  pwa_icon: "pwa_icon_media_id",
};

function setAssetMedia(kind: BrandingAssetKind, mediaId: string | null, actorId: string) {
  if (kind === "logo") return platformSettingsRepo.setLogoMedia(mediaId, actorId);
  if (kind === "favicon") return platformSettingsRepo.setFaviconMedia(mediaId, actorId);
  return platformSettingsRepo.setPwaIconMedia(mediaId, actorId);
}

async function replaceBrandingAsset(
  actor: { id: string; role: Role },
  kind: BrandingAssetKind,
  provider: StorageProvider,
  data: Buffer,
  originalFilename: string | null
) {
  // Look up whatever the CURRENT media id is (if any) so it can be
  // deleted once the new upload succeeds — otherwise every asset change
  // leaves the previous file as an orphan (the orphan-detection system
  // would eventually catch it, but cleaning up immediately at the point
  // of replacement is the same pattern media.service.ts's replaceMedia
  // already uses for product images, and there's no reason branding
  // assets should behave differently).
  const { queryOne } = await import("../db/client");
  const column = ASSET_COLUMN[kind];
  const before = await queryOne<{ media_id: string | null }>(`SELECT ${column} AS media_id FROM platform_settings WHERE id = 1`);

  const uploaded = await mediaService.uploadMedia({
    provider,
    data,
    originalFilename,
    altText: kind === "logo" ? "Platform logo" : kind === "favicon" ? "Platform favicon" : "PWA app icon",
    entityType: "platform_branding",
    entityId: null, // singleton — nothing to key by, see migration 0023's updated comment
  });

  const result = await setAssetMedia(kind, uploaded.media.id, actor.id);

  // Only delete the OLD asset after the new one is fully committed as
  // current — if deletion happened first and the upload/DB update then
  // failed, the platform would be left with no asset at all instead of
  // just a slightly stale one.
  if (before?.media_id) {
    await mediaService.removeMedia(provider, before.media_id).catch(() => {
      // Best-effort: the new asset is already live either way. A leftover
      // orphaned file is exactly what the existing orphan-detection
      // system (GET /admin/media/orphans) exists to catch later.
    });
  }

  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: `platform_settings.${kind}_uploaded`, targetType: "platform_settings", targetId: "1", metadata: { mediaId: uploaded.media.id } });
  return result;
}

export async function uploadLogo(actor: { id: string; role: Role }, provider: StorageProvider, data: Buffer, originalFilename: string | null) {
  return replaceBrandingAsset(actor, "logo", provider, data, originalFilename);
}

export async function uploadFavicon(actor: { id: string; role: Role }, provider: StorageProvider, data: Buffer, originalFilename: string | null) {
  return replaceBrandingAsset(actor, "favicon", provider, data, originalFilename);
}

export async function uploadPwaIcon(actor: { id: string; role: Role }, provider: StorageProvider, data: Buffer, originalFilename: string | null) {
  return replaceBrandingAsset(actor, "pwa_icon", provider, data, originalFilename);
}

async function removeBrandingAsset(actor: { id: string; role: Role }, kind: BrandingAssetKind, provider: StorageProvider) {
  // Look up the actual media id to delete via a direct query, since the
  // repo's public shape only exposes the resolved URL, not the raw id —
  // deletion needs the id. See platform-settings.repo.ts's SELECT_WITH_MEDIA.
  const { queryOne } = await import("../db/client");
  const column = ASSET_COLUMN[kind];
  const row = await queryOne<{ media_id: string | null }>(`SELECT ${column} AS media_id FROM platform_settings WHERE id = 1`);
  if (row?.media_id) {
    await mediaService.removeMedia(provider, row.media_id);
  }
  const result = await setAssetMedia(kind, null, actor.id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: `platform_settings.${kind}_removed`, targetType: "platform_settings", targetId: "1" });
  return result;
}

export async function removeLogo(actor: { id: string; role: Role }, provider: StorageProvider) {
  return removeBrandingAsset(actor, "logo", provider);
}

export async function removeFavicon(actor: { id: string; role: Role }, provider: StorageProvider) {
  return removeBrandingAsset(actor, "favicon", provider);
}

export async function removePwaIcon(actor: { id: string; role: Role }, provider: StorageProvider) {
  return removeBrandingAsset(actor, "pwa_icon", provider);
}

export async function setPwaInstallPromptEnabled(actor: { id: string; role: Role }, enabled: boolean) {
  const result = await platformSettingsRepo.setPwaInstallPromptEnabled(enabled, actor.id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "platform_settings.pwa_install_prompt_toggled", targetType: "platform_settings", targetId: "1", metadata: { enabled } });
  return result;
}

export async function setDeliveryFees(actor: { id: string; role: Role }, darEsSalaamFeeTzs: unknown, outsideDarFeeTzs: unknown) {
  const dar = Number(darEsSalaamFeeTzs);
  const outside = Number(outsideDarFeeTzs);
  if (!Number.isInteger(dar) || dar < 0) {
    throw new ValidationError("Validation failed.", { darEsSalaamFeeTzs: "Must be a non-negative whole number of TZS." });
  }
  if (!Number.isInteger(outside) || outside < 0) {
    throw new ValidationError("Validation failed.", { outsideDarFeeTzs: "Must be a non-negative whole number of TZS." });
  }
  const result = await platformSettingsRepo.setDeliveryFees(dar, outside, actor.id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "platform_settings.delivery_fees_changed", targetType: "platform_settings", targetId: "1", metadata: { darEsSalaamFeeTzs: dar, outsideDarFeeTzs: outside } });
  return result;
}

export async function setCodMessage(actor: { id: string; role: Role }, message: unknown) {
  const trimmed = typeof message === "string" ? message.trim() : null;
  if (trimmed && trimmed.length > 500) {
    throw new ValidationError("Validation failed.", { message: "Keep the message under 500 characters." });
  }
  const result = await platformSettingsRepo.setCodMessage(trimmed || null, actor.id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "platform_settings.cod_message_changed", targetType: "platform_settings", targetId: "1" });
  return result;
}

/** The COD message shown at checkout — the admin-configured one, or a sensible built-in default if none has been set yet (never a hardcoded string baked into the frontend). */
export function getEffectiveCodMessage(settings: { codMessage: string | null }): string {
  return settings.codMessage?.trim() || "Please pay the transport fee first using any of the payment numbers below. You will pay the remaining order amount after your parcel is delivered.";
}
