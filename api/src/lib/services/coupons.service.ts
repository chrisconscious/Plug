import * as couponsRepo from "../db/repos/coupons.repo";
import type { Coupon } from "../db/repos/coupons.repo";
import { ValidationError, NotFoundError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { Role } from "../rbac";

// ---- Admin CRUD ----

export async function listCoupons() {
  return couponsRepo.listCoupons();
}

function normalizeCode(code: unknown): string {
  if (typeof code !== "string" || code.trim().length < 3 || code.trim().length > 32) {
    throw new ValidationError("Validation failed.", { code: "Enter a code between 3 and 32 characters." });
  }
  return code.trim().toUpperCase();
}

function validateCouponFields(input: {
  discountType?: unknown;
  discountValue?: unknown;
  minOrderCents?: unknown;
  maxRedemptions?: unknown;
  maxRedemptionsPerCustomer?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
}): {
  discountType: "FIXED" | "PERCENTAGE";
  discountValue: number;
  minOrderCents: number;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  startsAt: string | null;
  endsAt: string | null;
} {
  const discountType = input.discountType;
  if (discountType !== "FIXED" && discountType !== "PERCENTAGE") {
    throw new ValidationError("Validation failed.", { discountType: "Choose Fixed or Percentage." });
  }
  const discountValue = Number(input.discountValue);
  if (!Number.isInteger(discountValue) || discountValue <= 0) {
    throw new ValidationError("Validation failed.", { discountValue: "Enter a whole number greater than 0." });
  }
  if (discountType === "PERCENTAGE" && discountValue > 100) {
    throw new ValidationError("Validation failed.", { discountValue: "A percentage discount can't exceed 100." });
  }
  const minOrderCents = input.minOrderCents === undefined || input.minOrderCents === null ? 0 : Number(input.minOrderCents);
  if (!Number.isInteger(minOrderCents) || minOrderCents < 0) {
    throw new ValidationError("Validation failed.", { minOrderCents: "Enter a whole TZS amount, 0 or more." });
  }
  const toNullableInt = (v: unknown, field: string) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new ValidationError("Validation failed.", { [field]: "Leave blank for no limit, or enter a whole number greater than 0." });
    return n;
  };
  const maxRedemptions = toNullableInt(input.maxRedemptions, "maxRedemptions");
  const maxRedemptionsPerCustomer = toNullableInt(input.maxRedemptionsPerCustomer, "maxRedemptionsPerCustomer");
  const startsAt = input.startsAt ? new Date(input.startsAt as string).toISOString() : null;
  const endsAt = input.endsAt ? new Date(input.endsAt as string).toISOString() : null;
  if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
    throw new ValidationError("Validation failed.", { endsAt: "The end date must be after the start date." });
  }
  return { discountType, discountValue, minOrderCents, maxRedemptions, maxRedemptionsPerCustomer, startsAt, endsAt };
}

export async function createCoupon(actor: { id: string; role: Role }, input: Record<string, unknown>) {
  const code = normalizeCode(input.code);
  const fields = validateCouponFields(input);
  const coupon = await couponsRepo.createCoupon({
    code,
    ...fields,
    scopeType: null,
    scopeId: null,
    createdBy: actor.id,
  });
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "coupon.created", targetType: "coupon", targetId: coupon.id, metadata: { code: coupon.code } });
  return coupon;
}

export async function updateCoupon(actor: { id: string; role: Role }, id: string, input: Record<string, unknown>) {
  const existing = await couponsRepo.findCouponById(id);
  if (!existing) throw new NotFoundError("Coupon not found.");
  const patch: couponsRepo.UpdateCouponInput = {};
  if (input.code !== undefined) patch.code = normalizeCode(input.code);
  if (input.active !== undefined) patch.active = Boolean(input.active);
  const touchesDiscountFields = ["discountType", "discountValue", "minOrderCents", "maxRedemptions", "maxRedemptionsPerCustomer", "startsAt", "endsAt"].some((k) => input[k] !== undefined);
  if (touchesDiscountFields) {
    Object.assign(patch, validateCouponFields({
      discountType: input.discountType ?? existing.discountType,
      discountValue: input.discountValue ?? existing.discountValue,
      minOrderCents: input.minOrderCents ?? existing.minOrderCents,
      maxRedemptions: input.maxRedemptions === undefined ? existing.maxRedemptions : input.maxRedemptions,
      maxRedemptionsPerCustomer: input.maxRedemptionsPerCustomer === undefined ? existing.maxRedemptionsPerCustomer : input.maxRedemptionsPerCustomer,
      startsAt: input.startsAt === undefined ? existing.startsAt : input.startsAt,
      endsAt: input.endsAt === undefined ? existing.endsAt : input.endsAt,
    }));
  }
  const updated = await couponsRepo.updateCoupon(id, patch);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "coupon.updated", targetType: "coupon", targetId: id });
  return updated;
}

// ---- Discount computation — lives in coupons.repo.ts (computeDiscountCents/
// assertCouponUsable/applyCouponWithinTransaction), not duplicated here, so
// orders.repo.ts can call the transaction-scoped version directly without
// an upward repo->service dependency. This service layer only wraps the
// repo's read-only preview for the checkout screen.

/**
 * Read-only preview for the checkout screen — validates without locking
 * or redeeming anything, so the customer can see the discount before
 * placing the order. The actual, authoritative computation that decides
 * what gets charged happens again in orders.repo.ts's
 * applyCouponWithinTransaction at order-creation time, which this
 * function deliberately mirrors (same repo-level math) but never
 * substitutes for: a preview a few seconds old must never be trusted as
 * the final price.
 */
export async function previewCoupon(code: string, subtotalCents: number): Promise<{ coupon: Coupon; discountCents: number }> {
  const coupons = await couponsRepo.listCoupons();
  const coupon = coupons.find((c) => c.code === code.trim().toUpperCase());
  if (!coupon) throw new ValidationError("Validation failed.", { couponCode: "This coupon code doesn't exist." });
  return { coupon, discountCents: couponsRepo.previewDiscountCents(coupon, subtotalCents) };
}
