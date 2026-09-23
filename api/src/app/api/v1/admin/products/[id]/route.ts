import { withRoute, json } from "@/lib/http";
import { validateBody, optional, nullable, required, isString, isNonNegativeInt, isArrayOfStrings, isStringArray, isArray, isBoolean } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateProduct, deleteProduct, replaceProductVariants } from "@/lib/services/catalog.service";

export const PATCH = withRoute({ permission: "products.update", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const patch = validateBody(body, {
    name: optional(isString),
    priceCents: optional(isNonNegativeInt),
    // Strict boolean — a `"true"`/`"false"` *string* payload would otherwise be
    // coerced by the predicate into `active = false` (silently taking the
    // product offline) instead of being rejected.
    active: optional(isBoolean),
    genderAudiences: optional(isArrayOfStrings),
    // Differs from genderAudiences: `[]` is a legal update that clears the
    // product out of every lifestyle (the service enforces that audiences
    // keep at least one entry; lifestyle membership is fully optional).
    lifestyleIds: optional(isStringArray),
    // Same "[] is a legal clearing update" shape as lifestyleIds above —
    // collection/campaign tags (drives homepage featured-product sections).
    tags: optional(isStringArray),
    sku: nullable(isString),
    shortDescription: nullable(isString),
    fullDescription: nullable(isString),
    badgeText: nullable(isString),
    offerLabel: nullable(isString),
    compareAtPriceCents: nullable(isNonNegativeInt),
    offerStartDate: nullable(isString),
    offerEndDate: nullable(isString),
  });
  const product = await updateProduct(user!, params.id!, patch);
  return json({ product });
});

/** Reconciles the full color×size×stock variant matrix in one atomic diff. */
export const PUT = withRoute({ permission: "products.update", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const { variants } = validateBody(body, {
    variants: required(isArray),
  });
  const result = await replaceProductVariants(user!, params.id!, (variants as unknown[]).map((raw) => {
    const v = raw as Record<string, unknown>;
    return {
      id: typeof v.id === "string" ? v.id : null,
      size: typeof v.size === "string" ? v.size : "",
      color: typeof v.color === "string" ? v.color : "",
      stockQty: typeof v.stockQty === "number" ? v.stockQty : Number.NaN,
      sku: typeof v.sku === "string" ? v.sku : null,
    };
  }));
  return json({ variants: result });
});

export const DELETE = withRoute({ permission: "products.delete", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  await deleteProduct(user!, params.id!);
  return json({ success: true });
});
