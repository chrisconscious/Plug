import * as heroRepo from "../db/repos/hero.repo";
import { NotFoundError, ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { HeroSlide, HeroType } from "../db/types";
import type { Role } from "../rbac";
import { heroImageStorage, heroVideoStorage } from "../storage/storage";

/** 40MB — hero videos are typically a short (5-15s), compressed, muted-loop clip; this comfortably covers that while still bounding upload size. */
const HERO_VIDEO_MAX_BYTES = 40 * 1024 * 1024;
import * as mediaService from "./media.service";
import * as mediaRepo from "../db/repos/media.repo";
import { logger } from "../logger";

/**
 * Lean public shape returned by the storefront endpoint — only the fields the
 * homepage carousel needs to render a slide. Never exposes storage keys or
 * upload metadata.
 */
export type PublicHeroSlide = {
  id: string;
  campaignLabel: string;
  headline: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  cta2Text: string | null;
  cta2Url: string | null;
  badgeText: string | null;
  editorialText: string | null;
  heroType: HeroType;
  imageUrl: string;
  videoUrl: string | null;
};

export function toPublicHeroSlide(s: HeroSlide): PublicHeroSlide {
  return {
    id: s.id,
    campaignLabel: s.campaignLabel,
    headline: s.headline,
    description: s.description,
    ctaText: s.ctaText,
    ctaUrl: s.ctaUrl,
    cta2Text: s.cta2Text,
    cta2Url: s.cta2Url,
    badgeText: s.badgeText,
    editorialText: s.editorialText,
    heroType: s.heroType,
    imageUrl: s.imageUrl,
    videoUrl: s.videoUrl,
  };
}

const HERO_TYPES: HeroType[] = ["promotional", "lifestyle", "editorial"];

function assertHeroType(v: unknown): Exclude<HeroType, never> {
  if (typeof v === "string" && (HERO_TYPES as string[]).includes(v)) return v as HeroType;
  throw new ValidationError("Validation failed.", { heroType: "heroType must be one of promotional, lifestyle, editorial." });
}

function assertNullableDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    throw new ValidationError("Validation failed.", { [field]: "Must be a valid date." });
  }
  return new Date(v).toISOString();
}

export function validateHeroInput(input: {
  campaignLabel?: unknown;
  headline?: unknown;
  description?: unknown;
  ctaText?: unknown;
  ctaUrl?: unknown;
  cta2Text?: unknown;
  cta2Url?: unknown;
  badgeText?: unknown;
  editorialText?: unknown;
  heroType?: unknown;
  displayOrder?: unknown;
  isActive?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fields: Record<string, string> = {};
  const campaignLabel = str(input.campaignLabel);
  const headline = str(input.headline);
  const description = str(input.description);
  const ctaText = str(input.ctaText);
  const ctaUrl = str(input.ctaUrl);
  if (!campaignLabel) fields.campaignLabel = "Campaign label is required.";
  // Mirror the database's NOT BLANK constraints (0013: hero_campaign_label_not_blank,
  // hero_headline_not_blank, hero_description_not_blank, hero_cta_text_not_blank,
  // hero_cta_url_not_blank). These used to be DB-only, so a blank value slipped
  // through app validation and surfaced as a raw 500 ("check constraint ...
  // violated") instead of a proper 400 with a per-field message.
  if (!headline) fields.headline = "Headline is required.";
  if (!description) fields.description = "Description is required.";
  if (!ctaText) fields.ctaText = "CTA text is required.";
  if (!ctaUrl) fields.ctaUrl = "CTA link is required.";

  // Second CTA is entirely optional, but if either half is provided, both
  // must be — a slide with a button label and no destination (or vice
  // versa) is a broken half-configured button, not a valid "no second CTA"
  // state. Mirrors the DB-level hero_cta2_both_or_neither constraint.
  const cta2Text = str(input.cta2Text) || null;
  const cta2Url = str(input.cta2Url) || null;
  if ((cta2Text === null) !== (cta2Url === null)) {
    fields.cta2Text = "Provide both a label and a destination for the second button, or leave both blank.";
  }

  const startDate = assertNullableDate(input.startDate, "startDate");
  const endDate = assertNullableDate(input.endDate, "endDate");
  if (startDate && endDate && new Date(startDate).getTime() > new Date(endDate).getTime()) {
    fields.startDate = "Start date must be on or before the end date.";
  }

  const displayOrder =
    input.displayOrder === undefined || input.displayOrder === null || input.displayOrder === ""
      ? 0
      : Number(input.displayOrder);
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    fields.displayOrder = "Display order must be a non-negative whole number.";
  }
  const isActive = input.isActive === undefined ? true : Boolean(input.isActive);

  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Validation failed.", fields);
  }
  return {
    campaignLabel,
    headline,
    description,
    ctaText,
    ctaUrl,
    cta2Text,
    cta2Url,
    badgeText: str(input.badgeText) || null,
    editorialText: str(input.editorialText) || null,
    heroType: assertHeroType(input.heroType === undefined ? "lifestyle" : input.heroType),
    displayOrder,
    isActive,
    startDate,
    endDate,
  };
}

export async function listActiveHeroSlides(): Promise<PublicHeroSlide[]> {
  return (await heroRepo.listActiveHeroSlides()).map(toPublicHeroSlide);
}

export async function listAllHeroSlides(): Promise<HeroSlide[]> {
  return heroRepo.listAllHeroSlides();
}

export type CreateHeroInput = Parameters<typeof validateHeroInput>[0] & {
  imageUrl: string;
  storageKey?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
};

export async function createHeroSlide(actor: { id: string; role: Role }, input: CreateHeroInput) {
  const data = validateHeroInput(input);
  const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl.trim() : "";
  // An inactive/scheduled draft may be created without a final image (uploaded
  // right after via the image endpoint); an active one must already have one.
  if (data.isActive && !imageUrl) {
    throw new ValidationError("Validation failed.", { imageUrl: "An active hero must have an image." });
  }
  const slide = await heroRepo.insertHeroSlide({
    ...data,
    imageUrl,
    storageKey: input.storageKey ?? null,
    contentType: input.contentType ?? null,
    sizeBytes: input.sizeBytes ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
  });
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "hero.created",
    targetType: "hero",
    targetId: slide.id,
    metadata: { campaignLabel: slide.campaignLabel, heroType: slide.heroType, displayOrder: slide.displayOrder },
  });
  return slide;
}

export async function updateHeroSlide(actor: { id: string; role: Role }, id: string, patch: CreateHeroInput) {
  const existing = await heroRepo.findHeroSlideById(id);
  if (!existing) throw new NotFoundError("Hero advertisement not found.");

  // PATCH with partial input: merge over the current row so required-field
  // validation sees a complete object. pg returns timestamptz columns as
  // real Date objects, so normalize the existing dates to ISO strings (the
  // declared type) before running validation, which requires strings.
  const toIsoOrNull = (v: string | Date | null | undefined): string | null =>
    v === null || v === undefined || v === "" ? null : new Date(v).toISOString();
  const merged = {
    campaignLabel: patch.campaignLabel ?? existing.campaignLabel,
    headline: patch.headline ?? existing.headline,
    description: patch.description ?? existing.description,
    ctaText: patch.ctaText ?? existing.ctaText,
    ctaUrl: patch.ctaUrl ?? existing.ctaUrl,
    cta2Text: patch.cta2Text !== undefined ? patch.cta2Text : existing.cta2Text,
    cta2Url: patch.cta2Url !== undefined ? patch.cta2Url : existing.cta2Url,
    badgeText: patch.badgeText !== undefined ? patch.badgeText : existing.badgeText,
    editorialText: patch.editorialText !== undefined ? patch.editorialText : existing.editorialText,
    heroType: patch.heroType ?? existing.heroType,
    displayOrder: patch.displayOrder ?? existing.displayOrder,
    isActive: patch.isActive !== undefined ? patch.isActive : existing.isActive,
    startDate: patch.startDate !== undefined ? patch.startDate : toIsoOrNull(existing.startDate as string | Date | null),
    endDate: patch.endDate !== undefined ? patch.endDate : toIsoOrNull(existing.endDate as string | Date | null),
  };
  const data = validateHeroInput(merged);

  const imageUrl =
    patch.imageUrl === undefined || patch.imageUrl === null || patch.imageUrl === ""
      ? existing.imageUrl
      : String(patch.imageUrl).trim();

  if (data.isActive && !imageUrl) {
    throw new ValidationError("Validation failed.", { imageUrl: "An active hero must have an image." });
  }

  const updated = await heroRepo.updateHeroSlide(id, {
    ...data,
    imageUrl,
    storageKey: patch.storageKey === undefined ? existing.storageKey : patch.storageKey,
    contentType: patch.contentType === undefined ? existing.contentType : patch.contentType,
    sizeBytes: patch.sizeBytes === undefined ? existing.sizeBytes : patch.sizeBytes,
    width: patch.width === undefined ? existing.width : patch.width,
    height: patch.height === undefined ? existing.height : patch.height,
  });
  if (!updated) throw new NotFoundError("Hero advertisement not found.");

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "hero.updated",
    targetType: "hero",
    targetId: id,
    metadata: { campaignLabel: updated.campaignLabel, heroType: updated.heroType, displayOrder: updated.displayOrder, isActive: updated.isActive },
  });
  return updated;
}

export async function deleteHeroSlide(actor: { id: string; role: Role }, id: string) {
  const existing = await heroRepo.findHeroSlideById(id);
  if (!existing) throw new NotFoundError("Hero advertisement not found.");
  await heroRepo.deleteHeroSlide(id);
  if (existing.storageKey) {
    await heroImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("hero.delete.image_delete_failed", {
        heroId: id,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(heroImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "hero.deleted",
    targetType: "hero",
    targetId: id,
    metadata: { campaignLabel: existing.campaignLabel },
  });
  return { success: true };
}

export async function reorderHeroSlides(actor: { id: string; role: Role }, orderedIds: string[]) {
  const existing = await heroRepo.listAllHeroSlides();
  const idSet = new Set(existing.map((s) => s.id));
  const missing = orderedIds.filter((id) => !idSet.has(id));
  if (missing.length > 0) {
    throw new ValidationError("Validation failed.", { orderedIds: "Every id must reference an existing hero advertisement." });
  }
  await heroRepo.reorderHeroSlides(orderedIds);
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "hero.reordered",
    targetType: "hero",
    targetId: orderedIds.join(","),
    metadata: { orderedIds },
  });
  return heroRepo.listAllHeroSlides();
}

// ---- Image upload / replace / remove (validated, mirrors product images) ----

export async function storeHeroImage(actor: { id: string; role: Role }, slideId: string, file: { data: Buffer; contentType: string; filename?: string | null }) {
  const existing = await heroRepo.findHeroSlideById(slideId);
  if (!existing) throw new NotFoundError("Hero advertisement not found.");

  const { media } = await mediaService.uploadMedia({
    provider: heroImageStorage,
    data: file.data,
    originalFilename: file.filename ?? null,
    entityType: "hero_slide",
    entityId: slideId,
  });

  let updated;
  try {
    updated = await heroRepo.updateHeroSlide(slideId, {
      imageUrl: media.url,
      storageKey: media.storageKey,
      contentType: media.contentType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
    });
  } catch (err) {
    await mediaService.removeMedia(heroImageStorage, media.id).catch(() => undefined);
    throw err;
  }

  // Old object superseded by the new one — clean up its storage object AND
  // its media registry row (same reasoning as catalog.service.ts's brand
  // logo / product image replace flows).
  if (existing.storageKey && existing.storageKey !== media.storageKey) {
    await heroImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("hero.image.old_object_delete_failed", {
        slideId,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(heroImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "hero.image.uploaded",
    targetType: "hero",
    targetId: slideId,
    metadata: { url: media.url, width: media.width, height: media.height, sizeBytes: media.sizeBytes },
  });
  return updated;
}

export async function removeHeroImage(actor: { id: string; role: Role }, slideId: string) {
  const existing = await heroRepo.findHeroSlideById(slideId);
  if (!existing) throw new NotFoundError("Hero advertisement not found.");
  if (existing.isActive) {
    throw new ValidationError("Cannot remove the image of an active hero advertisement. Deactivate it first.");
  }
  const updated = await heroRepo.updateHeroSlide(slideId, {
    imageUrl: "",
    storageKey: null,
    contentType: null,
    sizeBytes: null,
    width: null,
    height: null,
  });
  if (existing.storageKey) {
    await heroImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("hero.image.delete_failed", {
        slideId,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(heroImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "hero.image.removed",
    targetType: "hero",
    targetId: slideId,
    metadata: { key: existing.storageKey },
  });
  return updated;
}

/**
 * A slide's video is optional (unlike its image, which is required) — a
 * customer always sees at least the poster image while the video loads,
 * or if video is removed/never set, so there's no "active slide with
 * nothing to show" case to guard against the way removeHeroImage does.
 */
export async function storeHeroVideo(actor: { id: string; role: Role }, slideId: string, file: { data: Buffer; filename?: string | null }) {
  const existing = await heroRepo.findHeroSlideById(slideId);
  if (!existing) throw new NotFoundError("Hero advertisement not found.");

  const { media } = await mediaService.uploadVideoMedia({
    provider: heroVideoStorage,
    data: file.data,
    originalFilename: file.filename ?? null,
    entityType: "hero_video",
    entityId: slideId,
    maxBytes: HERO_VIDEO_MAX_BYTES,
  });

  let updated;
  try {
    updated = await heroRepo.updateHeroSlide(slideId, {
      videoUrl: media.url,
      videoStorageKey: media.storageKey,
      videoContentType: media.contentType,
      videoSizeBytes: media.sizeBytes,
    });
  } catch (err) {
    await mediaService.removeMedia(heroVideoStorage, media.id).catch(() => undefined);
    throw err;
  }

  if (existing.videoStorageKey && existing.videoStorageKey !== media.storageKey) {
    await heroVideoStorage.delete(existing.videoStorageKey).catch((err) => {
      logger.error("hero.video.old_object_delete_failed", {
        slideId,
        storageKey: existing.videoStorageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(heroVideoStorage.name, existing.videoStorageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "hero.video.uploaded",
    targetType: "hero",
    targetId: slideId,
    metadata: { url: media.url, sizeBytes: media.sizeBytes },
  });
  return updated;
}

export async function removeHeroVideo(actor: { id: string; role: Role }, slideId: string) {
  const existing = await heroRepo.findHeroSlideById(slideId);
  if (!existing) throw new NotFoundError("Hero advertisement not found.");
  if (!existing.videoStorageKey) throw new NotFoundError("This hero advertisement has no video.");

  const updated = await heroRepo.updateHeroSlide(slideId, {
    videoUrl: null,
    videoStorageKey: null,
    videoContentType: null,
    videoSizeBytes: null,
  });
  await heroVideoStorage.delete(existing.videoStorageKey).catch((err) => {
    logger.error("hero.video.delete_failed", {
      slideId,
      storageKey: existing.videoStorageKey,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  const oldMedia = await mediaRepo.findMediaByStorageKey(heroVideoStorage.name, existing.videoStorageKey).catch(() => null);
  if (oldMedia) {
    await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
  }
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "hero.video.removed",
    targetType: "hero",
    targetId: slideId,
    metadata: { key: existing.videoStorageKey },
  });
  return updated;
}
