import { withRoute, json } from "@/lib/http";
import { validateBody, optional, isString, isBoolean, isNonNegativeInt } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateCategory } from "@/lib/services/catalog.service";
import { ValidationError } from "@/lib/errors";

export const PATCH = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const patch = validateBody(body, {
    name: optional(isString),
    slug: optional(isString),
    icon: optional(isString),
    active: optional(isBoolean),
    displayOrder: optional(isNonNegativeInt),
  });
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("Validation failed.", { body: "Provide at least one field to update." });
  }
  const category = await updateCategory(user!, params.id!, patch);
  return json({ category });
});
