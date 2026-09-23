/**
 * Centralized error taxonomy. Every thrown error that a route handler wants
 * to translate into a specific HTTP status should extend AppError.
 *
 * Anything that is NOT an AppError is treated as an unexpected internal
 * error: logged with full detail server-side, but returned to the client as
 * a generic 500 with no stack trace / internals (see http.ts -> withRoute).
 */

export type ErrorCategory =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "EMAIL_NOT_VERIFIED"
  | "CSRF_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly httpStatus: number;
  readonly fields?: Record<string, string>;

  constructor(
    category: ErrorCategory,
    httpStatus: number,
    message: string,
    fields?: Record<string, string>
  ) {
    super(message);
    this.category = category;
    this.httpStatus = httpStatus;
    this.fields = fields;
  }
}

export class ValidationError extends AppError {
  constructor(message = "The submitted data is invalid.", fields?: Record<string, string>) {
    super("VALIDATION_ERROR", 400, message, fields);
  }
}

/** Intentionally generic message — do not reveal *why* auth failed (reduces account enumeration). */
export class AuthenticationError extends AppError {
  constructor(message = "Invalid credentials or session.") {
    super("AUTHENTICATION_ERROR", 401, message);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("AUTHORIZATION_ERROR", 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super("NOT_FOUND", 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "The request conflicts with the current state of the resource.") {
    super("CONFLICT", 409, message);
  }
}

export class RateLimitError extends AppError {
  /** Seconds until the caller's rate-limit window resets — set on the `Retry-After` response header (see http.ts's errorToResponse) so well-behaved clients know exactly when to retry instead of guessing/polling. */
  readonly retryAfterSeconds?: number;
  constructor(message = "Too many requests. Please slow down and try again shortly.", retryAfterSeconds?: number) {
    super("RATE_LIMITED", 429, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Thrown when an action (e.g. placing an order) requires a verified email and the account doesn't have one yet. */
export class EmailNotVerifiedError extends AppError {
  constructor(message = "Please verify your email address before continuing.") {
    super("EMAIL_NOT_VERIFIED", 403, message);
  }
}

/** Thrown when a state-changing request fails Origin validation or the double-submit CSRF token check — see security/csrf.ts. */
export class CsrfError extends AppError {
  constructor(message = "This request could not be verified. Please refresh the page and try again.") {
    super("CSRF_ERROR", 403, message);
  }
}
