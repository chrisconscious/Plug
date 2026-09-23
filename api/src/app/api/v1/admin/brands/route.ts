import { withRoute, json } from "@/lib/http";
import { validateBody, required, optional, isString } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listBrands, createBrand } from "@/lib/services/catalog.service";

// Unlike the public /brands (which only returns active brands), this admin
// listing includes every brand and its `active` flag — admin-gated so the
// deactivation state of a brand is never publicly enumerable.
export const GET = withRoute({ permission: "brands.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json({ brands: await listBrands() });
});

export const POST = withRoute({ permission: "brands.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const input = validateBody(body, {
    name: required(isString),
    slug: optional(isString),
  });
  const brand = await createBrand(user!, input);
  return json({ brand }, { status: 201 });
});
