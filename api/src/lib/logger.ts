/**
 * Minimal structured JSON logger with request correlation IDs.
 *
 * Deliberately dependency-free (pino/winston can be swapped in later without
 * changing call sites, since everything goes through this module).
 *
 * Every log line automatically includes the current request's correlation
 * ID, with NO call site needing to pass it explicitly — see
 * `requestContext` below. `withRoute` (http.ts) is the only place that ever
 * calls `requestContext.run(...)`, wrapping the entire request; every
 * `logger.*()` call anywhere underneath it — a route handler, a service, a
 * repo — picks up the same id automatically, because Node's
 * AsyncLocalStorage follows the async call chain, not the call site.
 *
 * SECURITY: never pass raw request bodies, passwords, tokens, or full
 * card/payment data into `meta`. Callers are responsible for redacting
 * before logging — see `redact()` below for the common fields.
 */
import { AsyncLocalStorage } from "async_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";

type RequestContext = { requestId: string };
export const requestContext = new AsyncLocalStorage<RequestContext>();

const SENSITIVE_KEYS = new Set([
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "secret",
  "cardNumber",
  "cvv",
]);

export function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return input;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const requestId = requestContext.getStore()?.requestId;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "plug-backend",
    environment: process.env.NODE_ENV ?? "development",
    message,
    ...(requestId ? { requestId } : {}),
    ...(meta ? redact(meta) as Record<string, unknown> : {}),
  };
  // eslint-disable-next-line no-console
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};

export function newRequestId(): string {
  return crypto.randomUUID();
}
