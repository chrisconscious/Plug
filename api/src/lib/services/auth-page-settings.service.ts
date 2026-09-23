import * as authPageSettingsRepo from "../db/repos/auth-page-settings.repo";
import * as mediaService from "./media.service";
import type { StorageProvider } from "../storage/provider";
import { ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { Role } from "../rbac";

export async function getAuthPageSettings() {
  const settings = await authPageSettingsRepo.getAuthPageSettings();
  return settings ?? {
    backgroundImageUrl: null,
    loginHeadline: "FASHION THAT DEFINES YOU",
    loginSubtitle: "Discover premium styles curated for you.",
    registerHeadline: "BECOME A MEMBER",
    registerSubtitle: "Discover premium styles curated for you.",
    updatedAt: new Date().toISOString(),
  };
}

const MAX_TEXT = 200;

function assertText(value: unknown, field: string, max = MAX_TEXT): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (trimmed.length > max) throw new ValidationError("Validation failed.", { [field]: `Must be ${max} characters or fewer.` });
  return trimmed;
}

export async function updateAuthPageSettings(actor: { id: string; role: Role }, input: Record<string, unknown>) {
  const fields: Record<string, string | null> = {};
  if (input.loginHeadline !== undefined) fields.login_headline = assertText(input.loginHeadline, "loginHeadline") ?? "";
  if (input.loginSubtitle !== undefined) fields.login_subtitle = assertText(input.loginSubtitle, "loginSubtitle") ?? "";
  if (input.registerHeadline !== undefined) fields.register_headline = assertText(input.registerHeadline, "registerHeadline") ?? "";
  if (input.registerSubtitle !== undefined) fields.register_subtitle = assertText(input.registerSubtitle, "registerSubtitle") ?? "";
  if (Object.keys(fields).length === 0) throw new ValidationError("Validation failed.", { body: "Provide at least one field to update." });
  const result = await authPageSettingsRepo.updateAuthPageFields(fields, actor.id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "auth_page_settings.updated", targetType: "auth_page_settings", targetId: "1", metadata: fields as Record<string, unknown> });
  return result;
}

export async function uploadBackgroundImage(actor: { id: string; role: Role }, provider: StorageProvider, data: Buffer, originalFilename: string | null) {
  const before = await authPageSettingsRepo.getAuthPageSettings();
  const uploaded = await mediaService.uploadMedia({
    provider,
    data,
    originalFilename,
    altText: "Auth page background",
    entityType: "auth_page_settings",
    entityId: null,
  });
  const result = await authPageSettingsRepo.updateAuthPageField("background_image_url", uploaded.media.url, actor.id);
  // Best-effort delete old background image
  if (before?.backgroundImageUrl) {
    const oldRows = await import("../db/client").then((m) => m.queryOne<{ id: string }>("SELECT id FROM media WHERE url = $1", [before.backgroundImageUrl]));
    if (oldRows?.id) await mediaService.removeMedia(provider, oldRows.id).catch(() => {});
  }
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "auth_page_settings.background_uploaded", targetType: "auth_page_settings", targetId: "1", metadata: { url: uploaded.media.url } });
  return result;
}

export async function removeBackgroundImage(actor: { id: string; role: Role }, provider: StorageProvider) {
  const before = await authPageSettingsRepo.getAuthPageSettings();
  if (before?.backgroundImageUrl) {
    const row = await import("../db/client").then((m) => m.queryOne<{ id: string }>("SELECT id FROM media WHERE url = $1", [before.backgroundImageUrl]));
    if (row?.id) await mediaService.removeMedia(provider, row.id).catch(() => {});
  }
  const result = await authPageSettingsRepo.updateAuthPageField("background_image_url", null, actor.id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "auth_page_settings.background_removed", targetType: "auth_page_settings", targetId: "1" });
  return result;
}