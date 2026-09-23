import { logger } from "./logger";

/**
 * Error monitoring — a thin, deliberately swappable abstraction, same
 * pattern as email.ts's provider abstraction: this is genuinely
 * functional today (every capture goes through the existing structured
 * JSON logger, which already redacts known-sensitive field names — see
 * logger.ts's redact()), and it is where a real APM/error-tracking SDK
 * (Sentry, Datadog, etc.) gets wired in later WITHOUT changing any of
 * this module's callers — they all go through captureError()/
 * captureMessage() below, never console.* directly.
 *
 * No real external service is configured here — there is no network
 * access in the environment that built this to install or verify one.
 * This is the honest, functional starting point: real capture (via
 * structured logs an operator can already search/alert on), not a fake
 * "monitoring is configured" placeholder.
 */

export type ErrorCategory =
  | "server_exception"
  | "failed_api_request"
  | "frontend_exception"
  | "failed_upload"
  | "authentication_failure"
  | "database_failure"
  | "storage_failure";

export interface CaptureErrorInput {
  category: ErrorCategory;
  message: string;
  /** Real stack trace — safe to include; the risk this module actually guards against is secrets in `context`, not stack traces. */
  stack?: string;
  requestId?: string;
  /** The endpoint/route this happened on, e.g. "POST /api/v1/orders". */
  endpoint?: string;
  /** A user id, never an email/name/other PII beyond what's already logged elsewhere in this app's audit trail. */
  userId?: string;
  /** Arbitrary additional context — goes through the SAME redaction as every other structured log (see logger.ts), but callers should still never intentionally pass a secret here. */
  context?: Record<string, unknown>;
}

const NEVER_CAPTURE_KEYS = new Set([
  "password", "token", "accesstoken", "refreshtoken", "cookie", "cookies",
  "secret", "authorization", "cardnumber", "cvv", "resettoken",
]);

/** Defense-in-depth on top of logger.ts's own redact() — this module's own explicit "never capture" list, checked independently. */
function stripKnownSecrets(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) return context;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (NEVER_CAPTURE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export function captureError(input: CaptureErrorInput): void {
  logger.error(`[monitoring] ${input.category}`, {
    errorCategory: input.category,
    requestId: input.requestId,
    endpoint: input.endpoint,
    userId: input.userId,
    message: input.message,
    stack: input.stack,
    ...stripKnownSecrets(input.context),
  });
}
