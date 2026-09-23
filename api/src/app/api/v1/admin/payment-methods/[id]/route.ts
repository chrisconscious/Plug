import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { deletePaymentMethod, updatePaymentMethod } from "@/lib/services/payment-methods.service";
import type { PaymentMethodInput } from "@/lib/services/payment-methods.service";

export const PATCH = withRoute({ permission: "payment_methods.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = (await req.json().catch(() => ({}))) as PaymentMethodInput;
  const method = await updatePaymentMethod(user!, params.id!, body);
  return json({ method });
});

export const DELETE = withRoute({ permission: "payment_methods.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  const result = await deletePaymentMethod(user!, params.id!);
  return json(result);
});
