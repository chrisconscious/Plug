/**
 * Email sending.
 *
 * Two providers: "stub" (default) logs every email to the server console
 * instead of delivering it — safe for local dev, loudly warned-about if
 * left on in production (see config.ts's own fail-fast/warning checks
 * for EMAIL_PROVIDER, which are the primary place this gets caught).
 * "resend" sends real email via the Resend API (https://resend.com) — a
 * plain REST call, no SDK dependency added, since Resend's API is a
 * single simple POST.
 *
 * ⚠️ VERIFICATION STATUS: sendViaResend below was written against
 * Resend's documented REST API (POST /emails, Bearer auth, a JSON body
 * of from/to/subject/text — https://resend.com/docs/api-reference/emails/send-email),
 * but this development environment has no network access to actually
 * call it with a real API key. It has NOT been executed against a real
 * Resend account. Treat it as correct-by-review, not a verified-working
 * integration, until it's actually run with real credentials — same
 * standard as storage/s3-provider.ts's own disclosure, stated here for
 * the same reason: don't gloss over what hasn't actually been run.
 *
 * Every call site in this codebase goes through this one function, so
 * that's the only place that needs to change to add a different
 * provider (SES, SendGrid, SMTP, etc.) later.
 */
import { logger } from "./logger";
import { config } from "./config";
import { getPlatformSettings } from "./services/platform-settings.service";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
};

async function sendViaResend(email: OutgoingEmail): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.resend.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.email.resend.fromAddress,
      to: [email.to],
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!res.ok) {
    // Never let a raw provider error (which can include request/account
    // details) leak past this module — log the detail server-side, but
    // every caller of sendVerificationEmail/sendPasswordResetEmail
    // already treats "the email step failed" as non-fatal to the
    // surrounding request (see auth.service.ts), so throwing here is
    // safe and gets the failure recorded rather than silently swallowed.
    const body = await res.text().catch(() => "");
    logger.error("email.resend_send_failed", { to: email.to, status: res.status, body: body.slice(0, 500) });
    throw new Error("Failed to send email.");
  }
}

function logStubEmail(email: OutgoingEmail): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "\n──────────── DEV EMAIL STUB (not actually sent) ────────────",
      `To:      ${email.to}`,
      `Subject: ${email.subject}`,
      "",
      email.text,
      "──────────────────────────────────────────────────────────\n",
    ].join("\n")
  );
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  if (config.email.provider === "resend") {
    await sendViaResend(email);
    return;
  }
  if (process.env.NODE_ENV === "production") {
    // Loud, not silent: if this ever runs in production without a real
    // provider wired up, whoever's watching the logs should know
    // immediately that emails are NOT actually being delivered.
    logger.warn("email.stub_used_in_production", { to: email.to, subject: email.subject });
  }
  logStubEmail(email);
}

/**
 * Reads the live, configured platform name (see platform-settings.service.ts
 * — a Super Admin can change this without a code deploy) rather than
 * hardcoding a brand name into email copy. Falls back to "PLUG" (the
 * platform_settings table's own shipped default — see migration 0029) if
 * the settings read fails for any reason, so a transient DB hiccup never
 * blocks an email from going out with at least a sensible name in it.
 */
async function currentPlatformName(): Promise<string> {
  try {
    const settings = await getPlatformSettings();
    return settings.platformName;
  } catch {
    return "PLUG";
  }
}

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  const platformName = await currentPlatformName();
  await sendEmail({
    to,
    subject: `Verify your ${platformName} email address`,
    text:
      `Welcome to ${platformName}!\n\n` +
      `Please verify your email address by opening this link:\n${verifyUrl}\n\n` +
      `This link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const platformName = await currentPlatformName();
  await sendEmail({
    to,
    subject: `Reset your ${platformName} password`,
    text:
      `We received a request to reset your ${platformName} password.\n\n` +
      `Open this link to choose a new password:\n${resetUrl}\n\n` +
      `This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email — your password will not be changed.`,
  });
}
