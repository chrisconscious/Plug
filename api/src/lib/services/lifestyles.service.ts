/**
 * Shop by Lifestyle service — the production logic behind the lifestyle
 * taxonomy (migration 0019).
 *
 * Invariants enforced here (with DB CHECK/FK backstops):
 *   - A lifestyle needs a unique slug and a non-blank name.
 *   - An ACTIVE lifestyle must have a hero image — the homepage cards and the
 *     /lifestyle/:slug page always render a real photo, never a placeholder.
 *   - Deleting a lifestyle with assigned products is refused (friendly
 *     message); the product_lifestyles ON DELETE RESTRICT is the DB backstop.
 *   - Activating a previously-drafted lifestyle is only possible once it has
 *     an image (upload through the validated pipeline).
 *
 * Image handling mirrors hero.service.ts / brand logos: magic-byte sniffing
 * (PNG/JPEG/WebP; SVG rejected), size cap, bytes written to disk storage,
 * public URL kept in the row, old object cleaned up best-effort.
 */
import * as lifestyleRepo from "../db/repos/lifestyles.repo";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { Lifestyle } from "../db/types";
import type { Role } from "../rbac";
import { lifestyleImageStorage } from "../storage/storage";
import * as mediaService from "./media.service";
import * as mediaRepo from "../db/repos/media.repo";
import { logger } from "../logger";

const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Lean storefront shape — only what the homepage cards + detail pages render. */
export type PublicLifestyle = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  heroImageUrl: string;
  /** Active products assigned to this lifestyle (lets cards show real counts). */
  productCount: number;
};

function toPublicLifestyle(l: Lifestyle): PublicLifestyle {
  return {
    id: l.id,
    slug: l.slug,
    name: l.name,
    shortDescription: l.shortDescription,
    heroImageUrl: l.heroImageUrl ?? "",
    productCount: l.productCount ?? 0,
  };
}

function assertName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name) throw new ValidationError("Validation failed.", { name: "Name is required." });
  return name;
}

// ---- Storefront reads ----

/** Active lifestyles for the homepage "Shop by Lifestyle" section, ordered. */
export async function listLifestylesPublic(): Promise<PublicLifestyle[]> {
  return (await lifestyleRepo.listActiveLifestyles()).map(toPublicLifestyle);
}

/** Every lifestyle (incl. drafts) for the admin management screen. */
export async function listLifestylesAdmin(): Promise<Lifestyle[]> {
  return lifestyleRepo.listLifestyles();
}

/** Active-lifestyle lookup for the detail page; inactive/missing → 404. */
export async function getLifestyleBySlugPublic(slug: string): Promise<PublicLifestyle> {
  const lifestyle = await lifestyleRepo.findLifestyleBySlug(slug);
  if (!lifestyle || !lifestyle.active) throw new NotFoundError("Lifestyle not found.");
  return toPublicLifestyle(lifestyle);
}

// ---- Admin CRUD ----

export type CreateLifestyleInput = {
  name: string;
  slug?: string;
  shortDescription?: string | null;
  active?: boolean;
  displayOrder?: number;
};

export async function createLifestyle(actor: { id: string; role: Role }, input: CreateLifestyleInput) {
  const name = assertName(input.name);
  const slug = (input.slug && input.slug.trim() ? slugify(input.slug) : slugify(name)) || "lifestyle";
  const shortDescription = input.shortDescription?.trim() || null;
  const active = input.active === true;
  const displayOrder =
    input.displayOrder === undefined || input.displayOrder === null ? 0 : Number(input.displayOrder);
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    throw new ValidationError("Validation failed.", { displayOrder: "Display order must be a non-negative whole number." });
  }
  const lifestyle = await lifestyleRepo.insertLifestyle({ slug, name, shortDescription, active, displayOrder });

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "lifestyle.created",
    targetType: "lifestyle",
    targetId: lifestyle.id,
    metadata: { slug, name, active, displayOrder },
  });
  return lifestyle;
}

export type UpdateLifestylePatch = Partial<{
  name: string;
  slug: string;
  shortDescription: string | null;
  active: boolean;
  displayOrder: number;
}>;

export async function updateLifestyle(actor: { id: string; role: Role }, id: string, patch: UpdateLifestylePatch) {
  const before = await lifestyleRepo.findLifestyleById(id);
  if (!before) throw new NotFoundError("Lifestyle not found.");

  const normalized: UpdateLifestylePatch = {};
  if (patch.name !== undefined) normalized.name = assertName(patch.name);
  if (patch.slug !== undefined) {
    normalized.slug = slugify(patch.slug) || before.slug;
  }
  if (patch.shortDescription !== undefined) {
    normalized.shortDescription = patch.shortDescription?.trim() || null;
  }
  if (patch.displayOrder !== undefined) {
    normalized.displayOrder = Number(patch.displayOrder);
    if (!Number.isInteger(normalized.displayOrder) || (normalized.displayOrder as number) < 0) {
      throw new ValidationError("Validation failed.", { displayOrder: "Display order must be a non-negative whole number." });
    }
  }
  if (patch.active === true) {
    // Friendly pre-check for a schema-level invariant (CHECK): an active
    // lifestyle must have a hero image. Cannot be fixed by this patch — the
    // image is a separate upload endpoint — so surface it now.
    normalized.active = true;
    const willHaveImage = before.heroImageUrl && before.heroImageUrl.trim() !== "";
    if (!willHaveImage) {
      throw new ValidationError(
        `Lifestyle "${before.name}" cannot be activated without a hero image. Upload one first.`,
        { active: "Upload a hero image before activating this lifestyle." }
      );
    }
  } else if (patch.active !== undefined) {
    normalized.active = patch.active;
  }

  if (Object.keys(normalized).length === 0) return before;

  try {
    const updated = await lifestyleRepo.updateLifestyleFields(id, normalized);
    if (!updated) throw new NotFoundError("Lifestyle not found.");

    await recordAuditEvent({
      actorId: actor.id,
      actorRole: actor.role,
      action: "lifestyle.updated",
      targetType: "lifestyle",
      targetId: id,
      metadata: {
        before: { name: before.name, slug: before.slug, active: before.active, displayOrder: before.displayOrder },
        after: { name: updated.name, slug: updated.slug, active: updated.active, displayOrder: updated.displayOrder },
      },
    });
    return updated;
  } catch (err) {
    // The repo already maps unique violations to ConflictError; rethrow through
    // so callers always see a typed AppError, never a raw SQL error.
    if (err instanceof ConflictError) throw err;
    throw err;
  }
}

/**
 * Delete safeguard: a lifestyle with products assigned is NOT deletable —
 * the admin must first unassign them from the product form. The DB enforces
 * the same rule via ON DELETE RESTRICT on product_lifestyles; this check
 * turns the raw FK violation into an actionable message.
 */
export async function deleteLifestyle(actor: { id: string; role: Role }, id: string) {
  const existing = await lifestyleRepo.findLifestyleById(id);
  if (!existing) throw new NotFoundError("Lifestyle not found.");

  const assigned = await lifestyleRepo.countAssignedProducts(id);
  if (assigned > 0) {
    throw new ValidationError(
      `"${existing.name}" cannot be deleted because ${assigned} product${assigned === 1 ? " is" : "s are"} still assigned to it. Unassign ${assigned === 1 ? "it" : "them"} first.`,
      { delete: "Unassign the products from this lifestyle before deleting it." }
    );
  }

  const removed = await lifestyleRepo.deleteLifestyleRow(id);
  if (!removed) throw new NotFoundError("Lifestyle not found.");

  if (existing.storageKey) {
    await lifestyleImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("lifestyle.delete.image_delete_failed", {
        lifestyleId: id,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(lifestyleImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "lifestyle.deleted",
    targetType: "lifestyle",
    targetId: id,
    metadata: { name: existing.name, slug: existing.slug },
  });
  return { success: true };
}

// ---- Hero image (validated upload / replace / remove) ----

export async function uploadLifestyleHero(actor: { id: string; role: Role }, id: string, file: { data: Buffer; contentType: string; filename?: string | null }) {
  const existing = await lifestyleRepo.findLifestyleById(id);
  if (!existing) throw new NotFoundError("Lifestyle not found.");

  const { media } = await mediaService.uploadMedia({
    provider: lifestyleImageStorage,
    data: file.data,
    originalFilename: file.filename ?? null,
    entityType: "lifestyle_hero",
    entityId: id,
  });

  let updated;
  try {
    updated = await lifestyleRepo.updateLifestyleFields(id, {
      heroImageUrl: media.url,
      storageKey: media.storageKey,
      contentType: media.contentType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
    });
    if (!updated) throw new NotFoundError("Lifestyle not found.");
  } catch (err) {
    await mediaService.removeMedia(lifestyleImageStorage, media.id).catch(() => undefined);
    throw err;
  }

  // Old object superseded by the new one — clean up its storage object AND
  // its media registry row (same reasoning as the other three domains).
  if (existing.storageKey && existing.storageKey !== media.storageKey) {
    await lifestyleImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("lifestyle.hero.old_object_delete_failed", {
        lifestyleId: id,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(lifestyleImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "lifestyle.hero.uploaded",
    targetType: "lifestyle",
    targetId: id,
    metadata: { url: media.url, width: media.width, height: media.height, sizeBytes: media.sizeBytes },
  });
  return updated;
}

export async function removeLifestyleHero(actor: { id: string; role: Role }, id: string) {
  const existing = await lifestyleRepo.findLifestyleById(id);
  if (!existing) throw new NotFoundError("Lifestyle not found.");
  if (existing.active) {
    throw new ValidationError("Cannot remove the hero image of an active lifestyle. Deactivate it first.");
  }
  const updated = await lifestyleRepo.updateLifestyleFields(id, {
    heroImageUrl: null,
    storageKey: null,
    contentType: null,
    sizeBytes: null,
    width: null,
    height: null,
  });
  if (!updated) throw new NotFoundError("Lifestyle not found.");

  if (existing.storageKey) {
    await lifestyleImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("lifestyle.hero.delete_failed", {
        lifestyleId: id,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(lifestyleImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "lifestyle.hero.removed",
    targetType: "lifestyle",
    targetId: id,
    metadata: { key: existing.storageKey },
  });
  return updated;
}