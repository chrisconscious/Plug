import { withRoute, json } from "@/lib/http";
import { validateBody, isString, isStrongPassword, required } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { resetPassword } from "@/lib/services/auth.service";

// Public — the caller has only a token from an email link, no session yet.
export const POST = withRoute({ auth: "none", rateLimit: RateLimitRules.passwordReset }, async ({ req }) => {
  const body = await req.json().catch(() => ({}));
  const { token, password } = validateBody(body, {
    token: required(isString),
    password: required(isStrongPassword),
  });
  await resetPassword(token, password);
  return json({ success: true });
});
