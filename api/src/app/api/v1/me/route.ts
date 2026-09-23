import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateMyProfile } from "@/lib/services/auth.service";

/** PATCH .../me — full name and/or phone number only. See auth.service.ts's updateMyProfile for why email is deliberately excluded. */
export const PATCH = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const updated = await updateMyProfile(user!.id, body);
  return json({ user: updated });
});
