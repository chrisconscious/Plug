/**
 * TOTP (RFC 6238) — the standard "6-digit code that changes every 30
 * seconds" mechanism used by Google Authenticator, Authy, 1Password, etc.
 *
 * Hand-rolled with Node core `crypto` only, same reasoning as
 * security/tokens.ts and security/password.ts: no external dependency is
 * installable offline in this phase. The algorithm itself (HMAC-SHA1
 * dynamic truncation) is a published, fixed spec — nothing here is a home-
 * grown cryptographic design, just a from-scratch implementation of one.
 * SHA-1 is used deliberately (not "for legacy reasons" but because it's
 * what RFC 6238 specifies and what every real authenticator app expects —
 * TOTP's security doesn't depend on SHA-1's collision resistance).
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const CODE_DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  // Any leftover bits (<5) are padding, per RFC 4648 — dropped, not encoded.
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** A fresh 160-bit shared secret, base32-encoded for both DB storage and QR/manual entry. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binCode =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(binCode % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
}

/** The current 6-digit code for a secret (mainly useful for tests/tooling — the app itself only ever verifies, never generates its own code to compare against). */
export function currentTotpCode(base32Secret: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  return hotp(base32Decode(base32Secret), counter);
}

/**
 * Verifies a user-entered code against a secret, tolerating one step of
 * clock drift on either side (±30s) — standard practice, since phone and
 * server clocks are never perfectly in sync. Constant-time comparison per
 * candidate to avoid a timing side-channel on which digit is wrong.
 */
export function verifyTotpCode(base32Secret: string, code: string, at: number = Date.now()): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const secret = base32Decode(base32Secret);
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    const candidate = hotp(secret, counter + drift);
    if (candidate.length === trimmed.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(trimmed))) {
      return true;
    }
  }
  return false;
}

/** Standard otpauth:// URI — pasting/scanning this is how authenticator apps normally get set up. Manual entry (the raw secret) always works too as a fallback. */
export function totpUri(secret: string, email: string, issuer = "PLUG"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${CODE_DIGITS}&period=${STEP_SECONDS}`;
}
