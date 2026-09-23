import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { createPaymentMethod, listAllPaymentMethods } from "@/lib/services/payment-methods.service";
import type { PaymentMethodInput } from "@/lib/services/payment-methods.service";

export const GET = withRoute({ permission: "payment_methods.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json({ methods: await listAllPaymentMethods() });
});

export const POST = withRoute({ permission: "payment_methods.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = (await req.json().catch(() => ({}))) as PaymentMethodInput;
  const method = await createPaymentMethod(user!, body);
  return json({ method }, { status: 201 });
});
