import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { previewCoupon } from "@/lib/services/coupons.service";

/**
 * Read-only preview for the checkout screen — lets the customer see the
 * discount before placing the order. NEVER the source of truth for what
 * gets charged: order creation re-validates and re-computes this from
 * scratch inside its own transaction (coupons.repo.ts's
 * applyCouponWithinTransaction), so a stale or tampered preview here can
 * never affect the actual amount charged.
 */
export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req }) => {
  const body = await req.json().catch(() => ({}));
  const code = body?.couponCode;
  const subtotalCents = Number(body?.subtotalCents);
  if (typeof code !== "string" || !code.trim()) {
    throw new ValidationError("Validation failed.", { couponCode: "Enter a coupon code." });
  }
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new ValidationError("Validation failed.", { subtotalCents: "Invalid subtotal." });
  }
  const { coupon, discountCents } = await previewCoupon(code, subtotalCents);
  return json({
    valid: true,
    discountCents,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
  });
});
