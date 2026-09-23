import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { changeMyPassword } from "@/lib/services/auth.service";

export const PATCH = withRoute({ auth: "required", rateLimit: RateLimitRules.login }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  await changeMyPassword(user!.id, body?.currentPassword, body?.newPassword);
  return json({ success: true });
});
