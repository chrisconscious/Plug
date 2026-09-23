import { withRoute, json } from "@/lib/http";
import { validateBody, required, isString } from "@/lib/validate";
import { ValidationError } from "@/lib/errors";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import * as adminProductLimitsRepo from "@/lib/db/repos/admin-product-limits.repo";
import { recordAuditEvent } from "@/lib/audit";

const VALID_TYPES = ["NONE", "FIXED_TOTAL", "FIXED_ACTIVE", "PER_DAY", "PER_MONTH"] as const;

/** Current usage for whichever window the admin's own limit type cares about — "no limit" still reports the all-time total, just with no cap to compare it against. */
async function currentUsage(adminUserId: string, limitType: (typeof VALID_TYPES)[number]): Promise<number> {
  const now = new Date();
  switch (limitType) {
    case "FIXED_ACTIVE":
      return adminProductLimitsRepo.countProductsForAdmin(adminUserId, { activeOnly: true });
    case "PER_DAY":
      return adminProductLimitsRepo.countProductsForAdmin(adminUserId, { since: new Date(now.getFullYear(), now.getMonth(), now.getDate()) });
    case "PER_MONTH":
      return adminProductLimitsRepo.countProductsForAdmin(adminUserId, { since: new Date(now.getFullYear(), now.getMonth(), 1) });
    default:
      return adminProductLimitsRepo.countProductsForAdmin(adminUserId, {});
  }
}

export const GET = withRoute({ permission: "admins.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ params }) => {
  const limit = await adminProductLimitsRepo.getLimit(params.id!);
  const limitType = limit?.limitType ?? "NONE";
  const used = await currentUsage(params.id!, limitType);
  return json({
    limitType,
    maxValue: limit?.maxValue ?? null,
    used,
    remaining: limit?.maxValue != null ? Math.max(0, limit.maxValue - used) : null,
  });
});

/**
 * Super-Admin-only (admins.manage — the same permission gating every
 * other admin-on-admin action) — a regular Admin can never set or view
 * another admin's limit, let alone their own.
 */
export const PUT = withRoute({ permission: "admins.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const { limitType } = validateBody(body, { limitType: required(isString) });
  if (!VALID_TYPES.includes(limitType as (typeof VALID_TYPES)[number])) {
    throw new ValidationError("Validation failed.", { limitType: "Choose a valid limit type." });
  }
  const maxValue = limitType === "NONE" ? null : Number(body?.maxValue);
  if (limitType !== "NONE" && (!Number.isInteger(maxValue) || (maxValue as number) < 0)) {
    throw new ValidationError("Validation failed.", { maxValue: "Enter a whole number, 0 or more." });
  }
  const limit = await adminProductLimitsRepo.setLimit(params.id!, limitType as (typeof VALID_TYPES)[number], maxValue, user!.id);
  await recordAuditEvent({
    actorId: user!.id,
    actorRole: user!.role,
    action: "admin.product_limit_set",
    targetType: "user",
    targetId: params.id!,
    metadata: { limitType, maxValue },
  });
  return json({ limit });
});
