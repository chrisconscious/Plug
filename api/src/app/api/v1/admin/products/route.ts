import { withRoute, json } from "@/lib/http";
import { validateBody, required, optional, nullable, isString, isNonNegativeInt, isArrayOfStrings, isStringArray } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listProducts, createProduct } from "@/lib/services/catalog.service";

// Admin listing intentionally reuses the public listProducts() query layer —
// same source of truth, no duplicated filtering logic. includeInactive keeps
// soft-deleted/draft products visible so admins can always re-open or remove
// them (they never have `active = true` again otherwise).
export const GET = withRoute({ permission: "products.read", rateLimit: RateLimitRules.adminGeneral }, async ({ req }) => {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "24") || 24));
  return json(await listProducts({ page, pageSize, includeInactive: true }));
});

export const POST = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const input = validateBody(body, {
    // Optional: when omitted the server derives it from `name`, and a slug
    // already taken by another product gets a short unique suffix instead
    // of failing the whole create (see createProduct).
    slug: optional(isString),
    name: required(isString),
    brandId: required(isString),
    categoryId: required(isString),
    priceCents: required(isNonNegativeInt),
    // At least one audience (women / men / unisex) is required on create; the
    // service layer also enforces this as a safety rail.
    genderAudiences: optional(isArrayOfStrings),
    // Optional lifestyle memberships (migration 0019) — validated against the
    // join FK; empty/absent = not assigned to any lifestyle. `[]` must be
    // accepted here exactly as PATCH accepts it.
    lifestyleIds: optional(isStringArray),
    // Collection/campaign tags — drives homepage "featured products"
    // sections and collection pages (see PremiumProducts.tsx's
    // `collection: "premium"` filter, matched via products.tags @> ARRAY[...]).
    // `[]` (no tags typed in the form) is valid — rejecting it made every
    // untagged product fail with "Validation failed.".
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
  const product = await createProduct(user!, input);
  return json({ product }, { status: 201 });
});
