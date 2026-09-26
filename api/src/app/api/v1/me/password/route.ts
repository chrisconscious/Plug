import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { changeMyPassword } from "@/lib/services/auth.service";
import { createAccessToken, createRefreshToken, revokeAllSessionsForUser, setAuthCookies, type SessionUser } from "@/lib/security/tokens";

export const PATCH = withRoute({ auth: "required", rateLimit: RateLimitRules.login }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  await changeMyPassword(user!.id, body?.currentPassword, body?.newPassword);
  // A changed password ends every other session (a stolen session or a
  // forgotten shared device must not outlive it); this device gets a fresh
  // session so the customer stays signed in here.
  await revokeAllSessionsForUser(user!.id);
  const sessionUser: SessionUser = { id: user!.id, email: user!.email, role: user!.role };
  const res = json({ success: true });
  setAuthCookies(res, createAccessToken(sessionUser), (await createRefreshToken(sessionUser)).token);
  return res;
});
