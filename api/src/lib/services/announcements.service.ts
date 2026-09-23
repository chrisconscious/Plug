import * as announcementsRepo from "../db/repos/announcements.repo";
import { NotFoundError, ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { Role } from "../rbac";
import type { Announcement } from "../db/types";

export async function listActiveAnnouncements(): Promise<Announcement[]> {
  return announcementsRepo.listActiveAnnouncements();
}

export async function listAllAnnouncements(): Promise<Announcement[]> {
  return announcementsRepo.listAllAnnouncements();
}

function assertMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) throw new ValidationError("Validation failed.", { message: "Announcement text is required." });
  if (message.length > 200) throw new ValidationError("Validation failed.", { message: "Keep announcements short — under 200 characters." });
  return message;
}

export async function createAnnouncement(actor: { id: string; role: Role }, input: { message: unknown; active?: unknown; displayOrder?: unknown }) {
  const message = assertMessage(input.message);
  const active = input.active === undefined ? true : Boolean(input.active);
  const displayOrder = Number.isInteger(input.displayOrder) && (input.displayOrder as number) >= 0 ? (input.displayOrder as number) : 0;

  const announcement = await announcementsRepo.insertAnnouncement({ message, active, displayOrder });
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "announcement.created", targetType: "announcement", targetId: announcement.id, metadata: { message } });
  return announcement;
}

export async function updateAnnouncement(actor: { id: string; role: Role }, id: string, input: { message?: unknown; active?: unknown; displayOrder?: unknown }) {
  const existing = await announcementsRepo.findAnnouncementById(id);
  if (!existing) throw new NotFoundError("Announcement not found.");

  const patch: announcementsRepo.AnnouncementPatch = {};
  if (input.message !== undefined) patch.message = assertMessage(input.message);
  if (input.active !== undefined) patch.active = Boolean(input.active);
  if (input.displayOrder !== undefined) {
    const order = Number(input.displayOrder);
    if (!Number.isInteger(order) || order < 0) throw new ValidationError("Validation failed.", { displayOrder: "Display order must be a non-negative whole number." });
    patch.displayOrder = order;
  }

  const updated = await announcementsRepo.updateAnnouncementFields(id, patch);
  if (!updated) throw new NotFoundError("Announcement not found.");
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "announcement.updated", targetType: "announcement", targetId: id, metadata: patch as Record<string, unknown> });
  return updated;
}

export async function deleteAnnouncement(actor: { id: string; role: Role }, id: string) {
  const existing = await announcementsRepo.findAnnouncementById(id);
  if (!existing) throw new NotFoundError("Announcement not found.");
  await announcementsRepo.deleteAnnouncement(id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "announcement.deleted", targetType: "announcement", targetId: id, metadata: { message: existing.message } });
}

export async function reorderAnnouncements(actor: { id: string; role: Role }, orderedIds: unknown) {
  const ids = Array.isArray(orderedIds) ? orderedIds.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) throw new ValidationError("Validation failed.", { orderedIds: "Provide the full list of announcement ids in the desired order." });
  await announcementsRepo.reorderAnnouncements(ids);
  // ids[0]! is safe here: the length===0 check above already returned,
  // so at this point ids has at least one element — but
  // noUncheckedIndexedAccess doesn't narrow array indexing from a
  // .length check, so TypeScript still sees ids[0] as possibly undefined.
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "announcement.reordered", targetType: "announcement", targetId: ids[0]!, metadata: { orderedIds: ids } });
}
