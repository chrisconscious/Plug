import { withRoute, json } from "@/lib/http";
import { validateBody, isString, required } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { disableMfa } from "@/lib/services/auth.service";

export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.mfaManagement }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { password } = validateBody(body, { password: required(isString) });
  await disableMfa(user!.id, password);
  return json({ success: true });
});
