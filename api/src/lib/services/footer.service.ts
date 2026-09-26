import * as footerRepo from "../db/repos/footer.repo";
import type { FooterPlatform } from "../db/repos/footer.repo";
import { NotFoundError, ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import { contactHref, normaliseContactValue } from "../contact-links";
import type { Role } from "../rbac";

const VALID_PLATFORMS: FooterPlatform[] = ["instagram", "tiktok", "facebook", "phone", "whatsapp", "email"];

export function isFooterPlatform(value: unknown): value is FooterPlatform {
  return typeof value === "string" && (VALID_PLATFORMS as string[]).includes(value);
}

/** Adds the ready-to-open link (`https://wa.me/255…`, `tel:+255…`, `mailto:…`, profile URL). */
function withHref<T extends { platform: FooterPlatform; value: string | null }>(link: T): T & { href: string | null } {
  return { ...link, href: contactHref(link.platform, link.value) };
}

/**
 * Public list: active channels with a usable link only. A value that no
 * longer validates (saved before per-platform checks existed) is left out
 * rather than sending customers to a broken or wrong destination.
 */
export async function listActiveFooterContactLinks() {
  const links = await footerRepo.listActiveFooterContactLinks();
  return links.map(withHref).filter((l) => l.href !== null);
}

/** Admin list: every channel, with the link it opens (null = not usable yet) for a preview. */
export async function listAllFooterContactLinks() {
  return (await footerRepo.listAllFooterContactLinks()).map(withHref);
}

export async function updateFooterContactLink(
  actor: { id: string; role: Role },
  platform: unknown,
  input: { value?: unknown; active?: unknown; displayOrder?: unknown }
) {
  if (!isFooterPlatform(platform)) {
    throw new ValidationError("Validation failed.", { platform: "Unknown footer platform." });
  }
  const existing = await footerRepo.findFooterContactLinkByPlatform(platform);
  if (!existing) throw new NotFoundError("Footer contact link not found.");

  const patch: footerRepo.FooterContactLinkPatch = {};
  if (input.value !== undefined) {
    if (input.value === null || (typeof input.value === "string" && input.value.trim() === "")) {
      patch.value = null;
    } else if (typeof input.value === "string") {
      patch.value = normaliseContactValue(platform, input.value);
    } else {
      throw new ValidationError("Validation failed.", { value: "Must be a string or null." });
    }
  }
  if (input.active !== undefined) {
    const nextActive = Boolean(input.active);
    // Mirrors the DB's own active-requires-value constraint with a clear
    // message instead of a raw constraint-violation error — check against
    // whichever value will actually be in effect after this same patch
    // (a request can set value and active together in one call).
    const effectiveValue = patch.value !== undefined ? patch.value : existing.value;
    if (nextActive && !effectiveValue) {
      throw new ValidationError("Validation failed.", { active: "Enter a value for this channel before activating it." });
    }
    patch.active = nextActive;
  }
  if (input.displayOrder !== undefined) {
    const order = Number(input.displayOrder);
    if (!Number.isInteger(order) || order < 0) {
      throw new ValidationError("Validation failed.", { displayOrder: "Display order must be a non-negative whole number." });
    }
    patch.displayOrder = order;
  }

  const updated = await footerRepo.updateFooterContactLink(platform, patch);
  if (!updated) throw new NotFoundError("Footer contact link not found.");
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "footer_contact_link.updated", targetType: "footer_contact_link", targetId: platform, metadata: { active: updated.active, hasValue: !!updated.value } });
  return withHref(updated);
}
