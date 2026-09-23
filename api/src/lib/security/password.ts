/**
 * Password hashing using Node's built-in `crypto.scrypt` (a memory-hard KDF
 * suitable for password storage — no external dependency required).
 *
 * Format stored: "scrypt:N:r:p:saltHex:hashHex" — the parameters are
 * embedded so they can be upgraded later without breaking old hashes
 * (verify reads the stored params; new hashes use CURRENT_PARAMS).
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "crypto";
import { promisify } from "util";

// `promisify` cannot infer the full (overloaded) scrypt signature, so pin the
// exact variant the app uses — (password, salt, keylen, options?) -> Buffer.
const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: ScryptOptions
) => Promise<Buffer>;

const CURRENT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(plainPassword, salt, CURRENT_PARAMS.keylen, {
    N: CURRENT_PARAMS.N,
    r: CURRENT_PARAMS.r,
    p: CURRENT_PARAMS.p,
  })) as Buffer;
  const { N, r, p } = CURRENT_PARAMS;
  return `scrypt:${N}:${r}:${p}:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(plainPassword: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  if (!nStr || !rStr || !pStr || !saltHex || !hashHex) return false;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  const derivedKey = (await scrypt(plainPassword, salt, expected.length, { N, r, p })) as Buffer;

  // Constant-time comparison — never use `===` or `Buffer.equals` naively
  // for secret comparison (timing side-channel).
  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}
