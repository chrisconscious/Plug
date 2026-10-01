import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { rotateRefreshToken } from "@/lib/services/auth.service";
import { getRefreshTokenFromRequest, setAuthCookies, clearAuthCookies } from "@/lib/security/tokens";
import { config } from "@/lib/config";

export const POST = withRoute({ auth: "none", rateLimit: RateLimitRules.refresh }, async ({ req }) => {
  const refreshToken = getRefreshTokenFromRequest(req);
  if (!refreshToken) {
    // No refresh cookie (expired or deleted) but the browser still asked, e.g.
    // because the readable session marker outlived it: clear what is left so
    // the next page load takes the signed-out fast path instead of repeating
    // /auth/me 401 + /auth/refresh 401.
    const res = json({ error: "AUTHENTICATION_ERROR", message: "Session expired. Please sign in again." }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }

  try {
    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(refreshToken);
    const res = json({ success: true, accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds });
    setAuthCookies(res, accessToken, newRefreshToken);
    return res;
  } catch (err) {
    const res = json({ error: "AUTHENTICATION_ERROR", message: "Session expired. Please sign in again." }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }
});
