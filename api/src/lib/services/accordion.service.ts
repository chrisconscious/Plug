import * as accordionRepo from "../db/repos/accordion.repo";
import { NotFoundError, ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { Role } from "../rbac";
import type { ProductAccordionSection } from "../db/types";

export async function listActiveAccordionSections(): Promise<ProductAccordionSection[]> {
  return accordionRepo.listActiveAccordionSections();
}

export async function listAllAccordionSections(): Promise<ProductAccordionSection[]> {
  return accordionRepo.listAllAccordionSections();
}

const MAX_TITLE = 120;
const MAX_BODY = 10000;

function assertTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title) throw new ValidationError("Validation failed.", { title: "Accordion section title is required." });
  if (title.length > MAX_TITLE) throw new ValidationError("Validation failed.", { title: `Keep the title under ${MAX_TITLE} characters.` });
  return title;
}

function assertBody(value: unknown): string {
  const body = typeof value === "string" ? value.trim() : "";
  if (!body) throw new ValidationError("Validation failed.", { body: "Accordion section body text is required." });
  if (body.length > MAX_BODY) throw new ValidationError("Validation failed.", { body: `Keep the body under ${MAX_BODY} characters.` });
  return body;
}

export async function createAccordionSection(actor: { id: string; role: Role }, input: { title?: unknown; body?: unknown; active?: unknown; displayOrder?: unknown }) {
  const title = assertTitle(input.title);
  const body = assertBody(input.body);
  const active = input.active === undefined ? true : Boolean(input.active);
  const displayOrder = Number.isInteger(input.displayOrder) && (input.displayOrder as number) >= 0 ? (input.displayOrder as number) : 0;

  const section = await accordionRepo.insertAccordionSection({ title, body, active, displayOrder });
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "accordion.created", targetType: "product_accordion_section", targetId: section.id, metadata: { title } });
  return section;
}

export async function updateAccordionSection(actor: { id: string; role: Role }, id: string, input: { title?: unknown; body?: unknown; active?: unknown; displayOrder?: unknown }) {
  const existing = await accordionRepo.findAccordionSectionById(id);
  if (!existing) throw new NotFoundError("Accordion section not found.");

  const patch: accordionRepo.AccordionPatch = {};
  if (input.title !== undefined) patch.title = assertTitle(input.title);
  if (input.body !== undefined) patch.body = assertBody(input.body);
  if (input.active !== undefined) patch.active = Boolean(input.active);
  if (input.displayOrder !== undefined) {
    const order = Number(input.displayOrder);
    if (!Number.isInteger(order) || order < 0) throw new ValidationError("Validation failed.", { displayOrder: "Display order must be a non-negative whole number." });
    patch.displayOrder = order;
  }

  const updated = await accordionRepo.updateAccordionSectionFields(id, patch);
  if (!updated) throw new NotFoundError("Accordion section not found.");
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "accordion.updated", targetType: "product_accordion_section", targetId: id, metadata: patch as Record<string, unknown> });
  return updated;
}

export async function deleteAccordionSection(actor: { id: string; role: Role }, id: string) {
  const existing = await accordionRepo.findAccordionSectionById(id);
  if (!existing) throw new NotFoundError("Accordion section not found.");
  await accordionRepo.deleteAccordionSection(id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "accordion.deleted", targetType: "product_accordion_section", targetId: id, metadata: { title: existing.title } });
}

export async function reorderAccordionSections(actor: { id: string; role: Role }, orderedIds: unknown) {
  const ids = Array.isArray(orderedIds) ? orderedIds.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) throw new ValidationError("Validation failed.", { orderedIds: "Provide the full list of accordion section ids in the desired order." });
  await accordionRepo.reorderAccordionSections(ids);
  // ids[0]! is safe here: the length===0 check above already returned,
  // so at this point ids has at least one element — but
  // noUncheckedIndexedAccess doesn't narrow array indexing from a
  // .length check, so TypeScript still sees ids[0] as possibly undefined.
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "accordion.reordered", targetType: "product_accordion_section", targetId: ids[0]!, metadata: { orderedIds: ids } });
}