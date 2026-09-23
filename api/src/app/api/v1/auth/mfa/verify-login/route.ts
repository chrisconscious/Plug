import { withRoute, json } from "@/lib/http";
import { validateBody, isString, required } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { completeMfaLogin } from "@/lib/services/auth.service";
import { setAuthCookies } from "@/lib/security/tokens";
import { config } from "@/lib/config";

// Public (auth: "none") deliberately — the caller doesn't have a session
// yet, only the short-lived mfaToken from the login response. Rate-limited
// same as login itself: this is exactly as guessable-in-a-loop as a
// password, so it needs the same protection.
export const POST = withRoute({ auth: "none", rateLimit: RateLimitRules.login }, async ({ req }) => {
  const body = await req.json().catch(() => ({}));
  const { mfaToken, code } = validateBody(body, {
    mfaToken: required(isString),
    code: required(isString),
  });
  const { user, accessToken, refreshToken } = await completeMfaLogin(mfaToken, code);
  const res = json({ user, accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds });
  setAuthCookies(res, accessToken, refreshToken);
  return res;
});
