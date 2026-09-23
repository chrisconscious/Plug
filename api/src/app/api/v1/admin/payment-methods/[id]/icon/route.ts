import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { uploadPaymentMethodIcon, removePaymentMethodIcon } from "@/lib/services/payment-methods.service";
import { paymentMethodIconStorage } from "@/lib/storage/storage";

export const POST = withRoute({ permission: "payment_methods.manage", rateLimit: RateLimitRules.uploads }, async ({ req, user, params }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the payment method icon.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const method = await uploadPaymentMethodIcon(user!, params.id!, paymentMethodIconStorage, data, file.name || null);
  return json({ method }, { status: 201 });
});

export const DELETE = withRoute({ permission: "payment_methods.manage", rateLimit: RateLimitRules.uploads }, async ({ user, params }) => {
  const method = await removePaymentMethodIcon(user!, params.id!, paymentMethodIconStorage);
  return json({ method });
});
