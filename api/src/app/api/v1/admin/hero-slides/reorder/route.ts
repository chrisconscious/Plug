import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { reorderHeroSlides } from "@/lib/services/hero.service";

export const PUT = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const orderedIds = (body as { orderedIds?: unknown }).orderedIds;
  if (!Array.isArray(orderedIds) || !orderedIds.every((v) => typeof v === "string" && v.length > 0)) {
    throw new ValidationError("Validation failed.", { orderedIds: "Must be an array of hero advertisement ids." });
  }
  const slides = await reorderHeroSlides(user!, orderedIds);
  return json({ slides });
});
