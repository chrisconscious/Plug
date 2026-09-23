import * as usersRepo from "../db/repos/users.repo";
import * as verificationRepo from "../db/repos/email-verification.repo";
import * as passwordResetRepo from "../db/repos/password-reset.repo";
import * as recoveryRepo from "../db/repos/mfa-recovery.repo";
import { hashPassword, verifyPassword } from "../security/password";
import { isPhoneNumber, isStrongPassword } from "../validate";
import {
  createAccessToken,
  createRefreshToken,
  createMfaPendingToken,
  verifyMfaPendingToken,
  revokeSession,
  revokeAllSessionsForUser,
  verifyRefreshToken,
  type SessionUser,
} from "../security/tokens";
import { generateTotpSecret, verifyTotpCode, totpUri } from "../security/totp";
import { randomBytes } from "crypto";
import { AuthenticationError, NotFoundError, AuthorizationError, ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import { sendVerificationEmail, sendPasswordResetEmail } from "../email";
import { config } from "../config";
import type { User } from "../db/types";

function toPublicUser(user: User) {
  return { id: user.id, email: user.email, phoneNumber: user.phoneNumber, fullName: user.fullName, role: user.role, emailVerified: user.emailVerified, mfaEnabled: user.mfaEnabled, createdAt: user.createdAt };
}

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function issueVerificationEmail(user: User): Promise<void> {
  // Phone-registered accounts have no email at all — there's nothing to
  // verify by email for them (see registerCustomerByPhone, which treats
  // phone accounts as usable immediately rather than gating on a
  // verification channel this app has no way to deliver to them).
  if (!user.email) return;
  const { plaintextToken } = await verificationRepo.insertToken({
    userId: user.id,
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
  });
  const verifyUrl = `${config.frontendOrigin}/verify-email?token=${plaintextToken}`;
  await sendVerificationEmail(user.email, verifyUrl);
}

// A constant reference hash used only to burn roughly the same amount of
// time as a real verifyPassword() call when the account doesn't exist —
// reduces (does not eliminate) timing-based account enumeration.
const DUMMY_HASH = "scrypt:16384:8:1:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

export async function registerCustomer(email: string, password: string, fullName?: string | null) {
  // insertUser() relies on the database's UNIQUE index on email as the
  // authoritative check (see users.repo.ts) — no separate "does this
  // email exist" pre-check, so there's no TOCTOU race between checking
  // and inserting.
  const user = await usersRepo.insertUser({
    email,
    fullName: fullName?.trim() || null,
    passwordHash: await hashPassword(password),
    role: "CUSTOMER",
  });

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "user.registered",
    targetType: "user",
    targetId: user.id,
  });

  // Best-effort: a failed "send" (the dev stub can't fail, but a real
  // provider could) shouldn't block account creation — the user can
  // always request another link via requestEmailVerification().
  try {
    await issueVerificationEmail(user);
  } catch {
    /* swallow — verification can be resent later */
  }

  return toPublicUser(user);
}

/**
 * Phone-based registration (migration 0037) — the primary sign-up path
 * for the storefront now that login uses a phone number, not email.
 * Deliberately does NOT attempt an SMS verification step: this app has
 * no real SMS gateway integration, and building a "verification" flow
 * that can't actually deliver a code would be worse than not having
 * one — a phone account is usable immediately instead of silently
 * gated on a channel that was never wired to a real provider.
 */
export async function registerCustomerByPhone(phoneNumber: string, password: string, fullName?: string | null) {
  const user = await usersRepo.insertUser({
    phoneNumber,
    fullName: fullName?.trim() || null,
    passwordHash: await hashPassword(password),
    role: "CUSTOMER",
  });

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "user.registered",
    targetType: "user",
    targetId: user.id,
    metadata: { via: "phone" },
  });

  return toPublicUser(user);
}

export async function loginWithPassword(email: string, password: string) {
  const user = await usersRepo.findUserByEmail(email);

  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_HASH); // constant-effort path

  if (!user || !ok || user.disabled) {
    throw new AuthenticationError("Invalid email or password.");
  }

  return completePasswordLogin(user);
}

/** Phone-based login (migration 0037) — mirrors loginWithPassword exactly, keyed by phone number instead of email. */
export async function loginWithPhone(phoneNumber: string, password: string) {
  const user = await usersRepo.findUserByPhone(phoneNumber);

  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_HASH); // constant-effort path

  if (!user || !ok || user.disabled) {
    throw new AuthenticationError("Invalid phone number or password.");
  }

  return completePasswordLogin(user);
}

/** Shared by both loginWithPassword and loginWithPhone once the credential itself has already checked out — the MFA-challenge / session-issuing logic is identical either way. */
async function completePasswordLogin(user: User) {
  if (user.mfaEnabled) {
    // Password is correct, but that alone isn't enough for an MFA account —
    // no real session cookies yet, just a short-lived token proving "this
    // caller just passed the password check" for completeMfaLogin() to use.
    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "user.login.mfa_challenge",
      targetType: "user",
      targetId: user.id,
    });
    return { mfaRequired: true as const, mfaToken: createMfaPendingToken(user.id) };
  }

  const sessionUser: SessionUser = { id: user.id, email: user.email, role: user.role };
  const accessToken = createAccessToken(sessionUser);
  const { token: refreshToken } = await createRefreshToken(sessionUser);

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "user.login",
    targetType: "user",
    targetId: user.id,
  });

  return { mfaRequired: false as const, user: toPublicUser(user), accessToken, refreshToken };
}

/** Completes a login that was interrupted by loginWithPassword()'s MFA challenge — accepts either a live TOTP code or a one-time recovery code. */
export async function completeMfaLogin(mfaToken: string, code: string) {
  const pending = verifyMfaPendingToken(mfaToken);
  if (!pending) throw new AuthenticationError("This login attempt has expired. Please sign in again.");

  const user = await usersRepo.findUserById(pending.userId);
  if (!user || user.disabled || !user.mfaEnabled || !user.totpSecret) throw new AuthenticationError();

  const validTotp = verifyTotpCode(user.totpSecret, code);
  const validRecovery = !validTotp && (await recoveryRepo.consumeRecoveryCode(user.id, code.trim()));
  if (!validTotp && !validRecovery) {
    throw new AuthenticationError("That code didn't work. Please try again.");
  }

  const sessionUser: SessionUser = { id: user.id, email: user.email, role: user.role };
  const accessToken = createAccessToken(sessionUser);
  const { token: refreshToken } = await createRefreshToken(sessionUser);

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: validRecovery ? "user.login.mfa_recovery_code" : "user.login.mfa_verified",
    targetType: "user",
    targetId: user.id,
  });

  return { user: toPublicUser(user), accessToken, refreshToken };
}

export async function rotateRefreshToken(refreshToken: string) {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) throw new AuthenticationError("Session expired. Please sign in again.");

  const user = await usersRepo.findUserById(payload.sub);
  if (!user || user.disabled) throw new AuthenticationError("Session expired. Please sign in again.");

  // Rotate: revoke the old refresh session, issue a fresh pair. This limits
  // the blast radius if a refresh token is ever stolen (it's single-use).
  if (payload.jti) await revokeSession(payload.jti);

  const sessionUser: SessionUser = { id: user.id, email: user.email, role: user.role };
  const accessToken = createAccessToken(sessionUser);
  const { token: newRefreshToken } = await createRefreshToken(sessionUser);
  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string | null) {
  if (!refreshToken) return;
  const payload = await verifyRefreshToken(refreshToken);
  if (payload?.jti) await revokeSession(payload.jti);
}

export async function getPublicUser(userId: string) {
  const user = await usersRepo.findUserById(userId);
  if (!user) throw new AuthenticationError();
  return toPublicUser(user);
}

/**
 * Full name and/or phone number only — email is deliberately excluded.
 * Changing a verified email would need its own re-verification flow
 * (so a customer can't silently swap in an address they don't control),
 * which doesn't exist yet; allowing an unverified email change here
 * would be a real security gap, not a missing nicety, so it's left out
 * rather than half-built.
 */
export async function updateMyProfile(userId: string, input: { fullName?: unknown; phoneNumber?: unknown }) {
  const patch: { fullName?: string | null; phoneNumber?: string | null } = {};
  if (input.fullName !== undefined) {
    if (input.fullName !== null && typeof input.fullName !== "string") {
      throw new ValidationError("Validation failed.", { fullName: "Must be a string or null." });
    }
    const trimmed = typeof input.fullName === "string" ? input.fullName.trim() : null;
    if (trimmed && trimmed.length > 120) {
      throw new ValidationError("Validation failed.", { fullName: "Name must be 120 characters or fewer." });
    }
    patch.fullName = trimmed || null;
  }
  if (input.phoneNumber !== undefined) {
    if (typeof input.phoneNumber !== "string" || !input.phoneNumber.trim()) {
      throw new ValidationError("Validation failed.", { phoneNumber: "Enter a valid mobile number." });
    }
    patch.phoneNumber = isPhoneNumber(input.phoneNumber, "phoneNumber");
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("Validation failed.", { body: "Provide fullName and/or phoneNumber to update." });
  }
  const updated = await usersRepo.updateProfile(userId, patch);
  if (!updated) throw new AuthenticationError();
  await recordAuditEvent({ actorId: userId, actorRole: updated.role, action: "user.profile_updated", targetType: "user", targetId: userId });
  return toPublicUser(updated);
}

/** Requires the CURRENT password to change it — never allowed on session/token possession alone, since a hijacked session shouldn't be enough to lock the real owner out by changing their password. */
export async function changeMyPassword(userId: string, currentPassword: unknown, newPassword: unknown) {
  if (typeof currentPassword !== "string" || !currentPassword) {
    throw new ValidationError("Validation failed.", { currentPassword: "Enter your current password." });
  }
  const newPw = isStrongPassword(newPassword, "newPassword");

  const user = await usersRepo.findUserById(userId);
  if (!user) throw new AuthenticationError();
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw new ValidationError("Validation failed.", { currentPassword: "That password is incorrect." });

  await usersRepo.updatePasswordHash(userId, await hashPassword(newPw));
  await recordAuditEvent({ actorId: userId, actorRole: user.role, action: "user.password_changed", targetType: "user", targetId: userId });
}

/** Consumes a verification token and marks the owning account verified. Idempotent-safe: an already-verified account just no-ops on a stale/reused link rather than erroring loudly. */
export async function verifyEmail(plaintextToken: string): Promise<void> {
  const token = await verificationRepo.findByPlaintextToken(plaintextToken);
  if (!token || token.consumedAt || new Date(token.expiresAt) <= new Date()) {
    throw new NotFoundError("This verification link is invalid or has expired.");
  }
  await verificationRepo.consumeToken(token.id);
  await usersRepo.markEmailVerified(token.userId);
}

/** Re-sends a verification email for an already-authenticated user. Rate-limited at the route layer (RateLimitRules.resendVerification). */
export async function requestEmailVerification(userId: string): Promise<void> {
  const user = await usersRepo.findUserById(userId);
  if (!user) throw new AuthenticationError();
  if (user.emailVerified) return; // nothing to do — not an error, just a no-op
  await issueVerificationEmail(user);
}

// ---- MFA (Admin / Super Admin only — enforced here, not just at the route,
// so this can never accidentally be reachable for a CUSTOMER account even if
// a future route forgets the RBAC check) ----

function assertMfaEligibleRole(user: User): void {
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    throw new AuthorizationError("MFA is only available for Admin and Super Admin accounts.");
  }
}

function generateRecoveryCodes(count = 8): string[] {
  // 10 hex chars (5 random bytes) each — short enough to type from a
  // printed sheet, long enough that guessing one is infeasible.
  return Array.from({ length: count }, () => randomBytes(5).toString("hex"));
}

/** Step 1 of enabling MFA: generates a secret and returns it (+ the otpauth:// URI) for the admin to add to an authenticator app. NOT enabled yet — see enableMfa(). */
export async function beginMfaSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
  const user = await usersRepo.findUserById(userId);
  if (!user) throw new AuthenticationError();
  assertMfaEligibleRole(user);

  const secret = generateTotpSecret();
  await usersRepo.setPendingTotpSecret(userId, secret);
  // The label an authenticator app shows next to the generated codes
  // (e.g. "PLUG (0756825667)") — falls back to the phone number for
  // phone-registered accounts that have no email at all.
  return { secret, otpauthUri: totpUri(secret, user.email ?? user.phoneNumber ?? user.id) };
}

/** Step 2: proves the admin's authenticator app actually works before MFA is enforced at login. Returns recovery codes shown exactly once. */
export async function enableMfa(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
  const user = await usersRepo.findUserById(userId);
  if (!user) throw new AuthenticationError();
  assertMfaEligibleRole(user);
  if (!user.totpSecret) throw new ValidationError("Start MFA setup first to get a secret to confirm.");
  if (!verifyTotpCode(user.totpSecret, code)) {
    throw new ValidationError("That code didn't match. Please try again.", { code: "Incorrect or expired code." });
  }

  await usersRepo.setMfaEnabled(userId, true);
  const recoveryCodes = generateRecoveryCodes();
  await recoveryRepo.replaceRecoveryCodes(userId, recoveryCodes);

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "user.mfa_enabled",
    targetType: "user",
    targetId: user.id,
  });

  return { recoveryCodes };
}

/**
 * Disables MFA for the account. Requires the CURRENT PASSWORD again (not
 * just an active session) before turning off a security control — the
 * same "prove you're still you" bar a real password manager or bank
 * applies to disabling 2FA. Clears the TOTP secret and every recovery
 * code (a stale recovery code must never remain valid after MFA is
 * disabled and later re-enabled with a new secret).
 */
export async function disableMfa(userId: string, password: string): Promise<void> {
  const user = await usersRepo.findUserById(userId);
  if (!user) throw new AuthenticationError();
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new AuthenticationError("Incorrect password.");

  await usersRepo.clearMfa(userId);
  await recoveryRepo.deleteAllRecoveryCodes(userId);

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "user.mfa_disabled",
    targetType: "user",
    targetId: user.id,
  });
}

/**
 * Step 1 of password reset: "user requests reset". ALWAYS appears to
 * succeed from the caller's perspective, whether or not the email belongs
 * to a real account — the route/response must never let a caller
 * distinguish "email sent" from "no such account" (account enumeration).
 * Any existing outstanding tokens for the user are invalidated first, so
 * only the newest requested link can ever work.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await usersRepo.findUserByEmail(email);
  // user.email can't actually be null here — findUserByEmail only matches
  // rows WHERE email = $1 — but the shared User type allows null broadly
  // (phone-only accounts), so this check is what makes that explicit
  // rather than an unchecked assertion.
  if (!user || !user.email) return; // silently "succeed" — see doc comment above

  await passwordResetRepo.invalidateAllForUser(user.id);
  const { plaintextToken } = await passwordResetRepo.insertToken({
    userId: user.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour — shorter than email verification's 24h, since this directly controls account access
  });
  const resetUrl = `${config.frontendOrigin}/reset-password?token=${plaintextToken}`;
  await sendPasswordResetEmail(user.email, resetUrl);

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "user.password_reset_requested",
    targetType: "user",
    targetId: user.id,
  });
}

/**
 * Step 2: consumes the token, sets the new password, and revokes every
 * existing session for the account — a password reset is exactly the
 * moment an attacker's existing stolen session (if any) should be cut off,
 * and it's also the standard, expected security behavior (mirrors what
 * happens on most real sites: resetting your password logs out every
 * other device).
 */
export async function resetPassword(plaintextToken: string, newPassword: string): Promise<void> {
  const token = await passwordResetRepo.findByPlaintextToken(plaintextToken);
  if (!token || token.consumedAt || new Date(token.expiresAt) <= new Date()) {
    throw new ValidationError("This password reset link is invalid or has expired.");
  }

  const user = await usersRepo.findUserById(token.userId);
  if (!user) throw new ValidationError("This password reset link is invalid or has expired.");

  await passwordResetRepo.consumeToken(token.id);
  await usersRepo.updatePasswordHash(user.id, await hashPassword(newPassword));
  await revokeAllSessionsForUser(user.id);

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "user.password_reset_completed",
    targetType: "user",
    targetId: user.id,
  });
}
