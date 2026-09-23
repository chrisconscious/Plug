import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { createHeroSlide, listAllHeroSlides, type CreateHeroInput } from "@/lib/services/hero.service";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const slides = await listAllHeroSlides();
  return json({ slides });
});

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const slide = await createHeroSlide(user!, body as CreateHeroInput);
  return json({ slide }, { status: 201 });
});
