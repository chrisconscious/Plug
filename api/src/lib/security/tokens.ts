/**
 * Session tokens: hand-rolled HMAC-SHA256 signed tokens (JWT-shaped, but
 * implemented with Node core `crypto` only — no external JWT library
 * dependency is available offline). If/when network access to npm is
 * restored, swapping this for `jose` is a contained change (only this file
 * and its call sites in http.ts / auth.service.ts).
 *
 * TWO TOKENS, deliberately different lifetimes and purposes:
 *  - ACCESS token: short-lived (default 15 min), sent on every request,
 *    stateless (never checked against the database on every request) —
 *    keeps hot-path auth fast, at the accepted cost that revoking it early
 *    isn't possible (it just expires quickly; see docs/SECURITY.md
 *    "remaining risks"). The user existence/disabled check below IS a DB
 *    read, but only one indexed primary-key lookup — cheap, and a
 *    reasonable candidate for a short-TTL Redis cache later if it ever
 *    shows up as a hot path in profiling (see docs/DATABASE.md caching
 *    notes) — not optimized preemptively without measurement.
 *  - REFRESH token: long-lived (default 14 days), persisted server-side
 *    (`sessions` table, migration 0002) by ID so it CAN be revoked
 *    (logout, "logout everywhere", admin disabling a user, role changes).
 *    Only ever sent to /api/v1/auth/refresh and /logout.
 *
 * Both are delivered as HttpOnly, Secure (in prod), SameSite=Lax cookies —
 * never exposed to JS, which is the main practical defense against XSS
 * token theft for this app.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { config } from "../config";
import * as sessionsRepo from "../db/repos/sessions.repo";
import * as usersRepo from "../db/repos/users.repo";
import type { Role } from "../rbac";

export type SessionUser = { id: string; email: string | null; role: Role };

type TokenPayload = { sub: string; email: string | null; role: Role; jti?: string; exp: number };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: TokenPayload, secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verify(token: string, secret: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  if (!header || !body || !signature) return null;
  const expectedSig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createAccessToken(user: SessionUser): string {
  const exp = Math.floor(Date.now() / 1000) + config.auth.accessTokenTtlSeconds;
  return sign({ sub: user.id, email: user.email, role: user.role, exp }, config.auth.accessTokenSecret);
}

export async function createRefreshToken(user: SessionUser): Promise<{ token: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + config.auth.refreshTokenTtlSeconds;
  await sessionsRepo.insertSession({ id: sessionId, userId: user.id, expiresAt: new Date(exp * 1000) });
  const token = sign(
    { sub: user.id, email: user.email, role: user.role, jti: sessionId, exp },
    config.auth.refreshTokenSecret
  );
  return { token, sessionId };
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload | null> {
  const payload = verify(token, config.auth.refreshTokenSecret);
  if (!payload || !payload.jti) return null;
  const session = await sessionsRepo.findSessionById(payload.jti);
  if (!session || session.revoked) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return payload;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await sessionsRepo.revokeSessionById(sessionId);
}

export function revokeAllSessionsForUser(userId: string): Promise<void> {
  return sessionsRepo.revokeAllSessionsForUser(userId);
}

// ---- MFA pending token ----
// Issued instead of real session cookies when a password check succeeds
// but the account has MFA enabled — proves "this caller just proved the
// password" for the ~5 minutes it takes to enter a TOTP code, without
// granting any real access. Deliberately NOT a TokenPayload/SessionUser
// (no role/email needed, and reusing that shape risks it ever being
// accepted somewhere real access tokens are expected).
type MfaPendingPayload = { sub: string; purpose: "mfa_pending"; exp: number };
const MFA_PENDING_TTL_SECONDS = 5 * 60;

export function createMfaPendingToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + MFA_PENDING_TTL_SECONDS;
  const payload: MfaPendingPayload = { sub: userId, purpose: "mfa_pending", exp };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", config.auth.accessTokenSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyMfaPendingToken(token: string): { userId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  if (!header || !body || !signature) return null;
  const expectedSig = createHmac("sha256", config.auth.accessTokenSecret).update(`${header}.${body}`).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MfaPendingPayload;
    if (payload.purpose !== "mfa_pending") return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

const ACCESS_COOKIE = "vv_access";
const REFRESH_COOKIE = "vv_refresh";
// Readable (non-httpOnly) "a session might exist" marker, set and cleared
// EXACTLY in sync with the auth cookies. The frontend cannot read the
// httpOnly vv_access/vv_refresh cookies, but it reads this one (web/src/
// lib/api.ts's hasSessionMarker()) to avoid firing /auth/me and
// /auth/refresh probes for visitors whose browser holds no session cookies
// at all — that refactor eliminated an unavoidable-and-harmless 401 spam
// pair (me→401, refresh→401) on every page load for logged-out users, at
// zero correctness cost: marker present ⇒ me() still runs and the server
// remains the sole authority; marker absent ⇒ no httpOnly session cookies
// can exist either, so the guest fast-path is sound.
const SESSION_MARKER_COOKIE = "vv_session";

export function setAuthCookies(res: NextResponse, accessToken: string, refreshToken: string) {
  const base = {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: "lax" as const,
    path: "/",
    domain: config.cookies.domain === "localhost" ? undefined : config.cookies.domain,
  };
  res.cookies.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: config.auth.accessTokenTtlSeconds });
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    ...base,
    maxAge: config.auth.refreshTokenTtlSeconds,
    path: "/api/v1/auth", // refresh token only ever needs to be sent to auth endpoints
  });
  res.cookies.set(SESSION_MARKER_COOKIE, "1", {
    ...base,
    httpOnly: false, // the frontend must be able to read it (see module doc above)
    maxAge: config.auth.refreshTokenTtlSeconds,
  });
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { maxAge: 0, path: "/" });
  res.cookies.set(REFRESH_COOKIE, "", { maxAge: 0, path: "/api/v1/auth" });
  res.cookies.set(SESSION_MARKER_COOKIE, "", { maxAge: 0, path: "/" });
}

export function getRefreshTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get(REFRESH_COOKIE)?.value ?? null;
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const payload = verify(token, config.auth.accessTokenSecret);
  if (!payload) return null;
  // Defense in depth: confirm the user still exists and isn't disabled,
  // even though the access token itself is stateless.
  const user = await usersRepo.findUserById(payload.sub);
  if (!user || user.disabled) return null;
  return { id: user.id, email: user.email, role: user.role };
}
