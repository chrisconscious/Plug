import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getBrandSectionSettings, updateBrandSectionSettings } from "@/lib/services/brand-settings.service";

// Brand-section display settings. Gated behind `brands.manage` (ADMIN +
// SUPER_ADMIN) so the people who already manage brands can tune the carousel,
// without opening storefront-wide configuration to everyone who can read stats.
export const GET = withRoute({ permission: "brands.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json(await getBrandSectionSettings());
});

export const PATCH = withRoute({ permission: "brands.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const settings = await updateBrandSectionSettings(user!, body.speed);
  return json(settings);
});