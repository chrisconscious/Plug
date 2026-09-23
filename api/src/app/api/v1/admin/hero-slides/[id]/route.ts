import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { deleteHeroSlide, updateHeroSlide, type CreateHeroInput } from "@/lib/services/hero.service";

export const PATCH = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const slide = await updateHeroSlide(user!, params.id!, body as CreateHeroInput);
  return json({ slide });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  const result = await deleteHeroSlide(user!, params.id!);
  return json(result);
});
