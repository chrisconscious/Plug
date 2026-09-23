import * as footerRepo from "../db/repos/footer.repo";
import type { FooterPlatform } from "../db/repos/footer.repo";
import { NotFoundError, ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import { isEmail, isPhoneNumber } from "../validate";
import type { Role } from "../rbac";

const VALID_PLATFORMS: FooterPlatform[] = ["instagram", "tiktok", "facebook", "phone", "whatsapp", "email"];

export function isFooterPlatform(value: unknown): value is FooterPlatform {
  return typeof value === "string" && (VALID_PLATFORMS as string[]).includes(value);
}

export async function listActiveFooterContactLinks() {
  return footerRepo.listActiveFooterContactLinks();
}

export async function listAllFooterContactLinks() {
  return footerRepo.listAllFooterContactLinks();
}

/**
 * Validates a link's value according to what that platform actually is —
 * a URL-based social platform must be a real http(s) URL (never a
 * javascript:/data: scheme, which this rejects outright as a genuine
 * security concern, not just a formatting nicety), phone/WhatsApp must be
 * a real phone number, email must be a real address.
 */
function validateValueForPlatform(platform: FooterPlatform, raw: string): string {
  const trimmed = raw.trim();
  if (platform === "instagram" || platform === "tiktok" || platform === "facebook") {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new ValidationError("Validation failed.", { value: "Enter a full URL, e.g. https://instagram.com/yourbrand." });
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ValidationError("Validation failed.", { value: "Only http/https links are allowed." });
    }
    return trimmed;
  }
  if (platform === "phone") {
    return isPhoneNumber(trimmed, "value");
  }
  if (platform === "whatsapp") {
    // Accept either a plain phone number or a full wa.me/whatsapp link —
    // the document itself says "number/link" for this one specifically.
    if (/^https?:\/\//i.test(trimmed)) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw new ValidationError("Validation failed.", { value: "Enter a valid WhatsApp link or phone number." });
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new ValidationError("Validation failed.", { value: "Only http/https links are allowed." });
      }
      return trimmed;
    }
    return isPhoneNumber(trimmed, "value");
  }
  // email
  return isEmail(trimmed, "value");
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
      patch.value = validateValueForPlatform(platform, input.value);
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
  return updated;
}
