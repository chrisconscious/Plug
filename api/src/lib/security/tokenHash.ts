import { randomBytes, createHash } from "crypto";

/**
 * Generates a new random bearer token for a single-use link (email
 * verification, password reset) — 32 bytes of real entropy, hex-encoded.
 * This is the value that goes in the email link and is NEVER persisted
 * anywhere; only `hashToken()`'s output of it is stored. See migration
 * 0028's header comment for why this matters (a database read alone must
 * never yield a directly usable token).
 */
export function generateBearerToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 hex of a bearer token — what actually gets stored/looked-up against, never the token itself. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
