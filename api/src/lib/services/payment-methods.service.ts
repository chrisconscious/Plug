import * as paymentRepo from "../db/repos/payment-methods.repo";
import { NotFoundError, ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { PaymentMethod, PaymentMethodKind } from "../db/types";
import type { Role } from "../rbac";
import * as mediaService from "./media.service";
import type { StorageProvider } from "../storage/provider";

const KINDS: PaymentMethodKind[] = ["CASH", "ONLINE"];

export type PaymentMethodInput = {
  kind: unknown;
  name: unknown;
  paymentNumber?: unknown;
  feeCents?: unknown;
  feeTzs?: unknown;
  isActive?: unknown;
  displayOrder?: unknown;
  instructions?: unknown;
};

function validatePaymentMethodInput(input: PaymentMethodInput) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fields: Record<string, string> = {};

  const kind = typeof input.kind === "string" && (KINDS as string[]).includes(input.kind)
    ? (input.kind as PaymentMethodKind)
    : (fields.kind = "kind must be CASH or ONLINE.", null);

  const name = str(input.name);
  if (!name) fields.name = "Name is required.";

  // Only ONLINE methods carry a payment number; it must be non-blank for them.
  const paymentNumber = input.paymentNumber == null || input.paymentNumber === ""
    ? null
    : str(input.paymentNumber);
  if (kind === "ONLINE" && !paymentNumber) {
    fields.paymentNumber = "An online payment method requires a payment number.";
  }

  // Only the CASH method carries a transport fee. The admin sets it in TZS
  // (`feeTzs`) so round shillings are stored EXACTLY; `feeCents` is stored
  // identically (both columns hold the same TZS amount, kept in sync for
  // backward compatibility with the order arithmetic CHECKs).
  const feeTzsInput = input.feeTzs === undefined || input.feeTzs === null || input.feeTzs === ""
    ? undefined
    : Number(input.feeTzs);
  const feeCentsInput = input.feeCents === undefined || input.feeCents === null || input.feeCents === ""
    ? undefined
    : Number(input.feeCents);

  let feeTzs: number;
  let feeCents: number;
  if (feeTzsInput !== undefined) {
    if (!Number.isInteger(feeTzsInput) || feeTzsInput < 0) {
      fields.feeCents = "Transport fee must be a non-negative whole amount (TZS).";
    }
    feeTzs = Math.max(0, Math.round(feeTzsInput));
    feeCents = feeTzs;
  } else if (feeCentsInput !== undefined) {
    if (!Number.isInteger(feeCentsInput) || feeCentsInput < 0) {
      fields.feeCents = "Fee must be a non-negative whole amount (in cents).";
    }
    feeCents = Math.max(0, Math.round(feeCentsInput));
    feeTzs = feeCents;
  } else {
    feeTzs = 0;
    feeCents = 0;
  }

  const displayOrder =
    input.displayOrder === undefined || input.displayOrder === null || input.displayOrder === ""
      ? 0
      : Number(input.displayOrder);
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    fields.displayOrder = "Display order must be a non-negative whole number.";
  }

  const isActive = input.isActive === undefined ? true : Boolean(input.isActive);

  // Optional — NULL means "use the generic 'send payment to the number
  // above' hint" (see migration 0036). Only validated for length/blankness
  // when the admin actually provided something; omitting it entirely
  // leaves the existing value alone on update (see the `undefined` check
  // in the return below, mirrored by updatePaymentMethod's own patch
  // logic distinguishing "not provided" from "explicitly cleared").
  let instructions: string | null | undefined;
  if (input.instructions !== undefined) {
    const trimmed = str(input.instructions);
    instructions = trimmed || null;
    if (trimmed.length > 500) fields.instructions = "Keep instructions under 500 characters.";
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Validation failed.", fields);
  }
  return { kind: kind!, name, paymentNumber, feeCents, feeTzs, displayOrder, isActive, instructions };
}

export async function listActivePaymentMethods(): Promise<PaymentMethod[]> {
  return paymentRepo.listActivePaymentMethods();
}

export async function listAllPaymentMethods(): Promise<PaymentMethod[]> {
  return paymentRepo.listAllPaymentMethods();
}

export async function createPaymentMethod(actor: { id: string; role: Role }, input: PaymentMethodInput) {
  const data = validatePaymentMethodInput(input);
  // Keep the CASH singleton invariant: no second CASH row may be created.
  if (data.kind === "CASH") {
    const existing = await paymentRepo.listAllPaymentMethods();
    if (existing.some((m) => m.kind === "CASH")) {
      throw new ValidationError("Validation failed.", { kind: "A Cash on Delivery method already exists — edit it instead." });
    }
  }
  const method = await paymentRepo.insertPaymentMethod(data);
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "payment_method.created",
    targetType: "payment_method",
    targetId: method.id,
    metadata: { kind: method.kind, name: method.name },
  });
  return method;
}

export async function updatePaymentMethod(actor: { id: string; role: Role }, id: string, patch: PaymentMethodInput) {
  const existing = await paymentRepo.findPaymentMethodById(id);
  if (!existing) throw new NotFoundError("Payment method not found.");

  // Merge partial input over existing row so full validation sees a complete object.
  const merged: PaymentMethodInput = {
    kind: patch.kind === undefined ? existing.kind : patch.kind,
    name: patch.name === undefined ? existing.name : patch.name,
    paymentNumber: patch.paymentNumber === undefined ? existing.paymentNumber : patch.paymentNumber,
    feeCents: patch.feeCents === undefined ? existing.feeCents : patch.feeCents,
    feeTzs: patch.feeTzs === undefined ? existing.feeTzs : patch.feeTzs,
    isActive: patch.isActive === undefined ? existing.isActive : patch.isActive,
    displayOrder: patch.displayOrder === undefined ? existing.displayOrder : patch.displayOrder,
    instructions: patch.instructions === undefined ? existing.instructions : patch.instructions,
  };
  const data = validatePaymentMethodInput(merged);

  // Prevent converting the CASH row into an ONLINE network (or vice versa).
  if (data.kind !== existing.kind) {
    throw new ValidationError("Validation failed.", { kind: "A payment method's type (Cash vs Online) cannot be changed." });
  }

  const updated = await paymentRepo.updatePaymentMethod({ ...data, id });
  if (!updated) throw new NotFoundError("Payment method not found.");
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "payment_method.updated",
    targetType: "payment_method",
    targetId: id,
    metadata: { kind: updated.kind, name: updated.name, isActive: updated.isActive, feeCents: updated.feeCents, feeTzs: updated.feeTzs },
  });
  return updated;
}

export async function deletePaymentMethod(actor: { id: string; role: Role }, id: string) {
  const existing = await paymentRepo.findPaymentMethodById(id);
  if (!existing) throw new NotFoundError("Payment method not found.");
  // The CASH row is the transport-fee singleton; prefer deactivating over deleting.
  if (existing.kind === "CASH") {
    throw new ValidationError("Validation failed.", { kind: "The Cash on Delivery method cannot be deleted — deactivate it instead." });
  }
  const removed = await paymentRepo.deletePaymentMethod(id);
  if (!removed) throw new NotFoundError("Payment method not found.");
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "payment_method.deleted",
    targetType: "payment_method",
    targetId: id,
    metadata: { name: existing.name },
  });
  return { success: true };
}

export async function reorderPaymentMethods(actor: { id: string; role: Role }, orderedIds: string[]) {
  const existing = await paymentRepo.listAllPaymentMethods();
  const idSet = new Set(existing.map((m) => m.id));
  const missing = orderedIds.filter((id) => !idSet.has(id));
  if (missing.length > 0) {
    throw new ValidationError("Validation failed.", { orderedIds: "Every id must reference an existing payment method." });
  }
  await paymentRepo.reorderPaymentMethods(orderedIds);
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "payment_method.reordered",
    targetType: "payment_method",
    targetId: orderedIds.join(","),
    metadata: { orderedIds },
  });
  return paymentRepo.listAllPaymentMethods();
}

/**
 * Upload/replace a payment method's small storefront icon — routed
 * through the same validated media pipeline every other image in this
 * app uses (magic-byte inspection, size/dimension limits, EXIF
 * stripping), not a second upload system.
 */
export async function uploadPaymentMethodIcon(actor: { id: string; role: Role }, id: string, provider: StorageProvider, data: Buffer, originalFilename: string | null) {
  const existing = await paymentRepo.findPaymentMethodById(id);
  if (!existing) throw new NotFoundError("Payment method not found.");
  const oldKey = await paymentRepo.getPaymentMethodIconStorageKey(id);
  const uploaded = await mediaService.uploadMedia({
    provider,
    data,
    originalFilename,
    altText: null,
    entityType: "payment_method_icon",
    entityId: id,
  });
  const updated = await paymentRepo.setPaymentMethodIcon(id, uploaded.media.url, uploaded.media.storageKey);
  if (!updated) throw new NotFoundError("Payment method not found.");
  if (oldKey) {
    await provider.delete(oldKey).catch(() => {
      // Best-effort — the new icon is already live; a leftover orphaned
      // file is exactly what the media orphan-detection system exists
      // to catch later, same reasoning as categories' image upload.
    });
  }
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "payment_method.icon_uploaded", targetType: "payment_method", targetId: id });
  return updated;
}

export async function removePaymentMethodIcon(actor: { id: string; role: Role }, id: string, provider: StorageProvider) {
  const existing = await paymentRepo.findPaymentMethodById(id);
  if (!existing) throw new NotFoundError("Payment method not found.");
  const oldKey = await paymentRepo.getPaymentMethodIconStorageKey(id);
  const updated = await paymentRepo.setPaymentMethodIcon(id, null, null);
  if (!updated) throw new NotFoundError("Payment method not found.");
  if (oldKey) await provider.delete(oldKey).catch(() => {});
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "payment_method.icon_removed", targetType: "payment_method", targetId: id });
  return updated;
}
