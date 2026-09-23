import { createHash } from "crypto";
import { query } from "../client";

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Replaces any existing recovery codes with a fresh set — called once at MFA enable time (and whenever the admin explicitly regenerates them). */
export async function replaceRecoveryCodes(userId: string, rawCodes: string[]): Promise<void> {
  await query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [userId]);
  for (const code of rawCodes) {
    await query(
      "INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)",
      [userId, hashCode(code)]
    );
  }
}

/** Consumes a recovery code if valid — deletes it on match so it can never be reused, returns whether it matched. */
export async function consumeRecoveryCode(userId: string, rawCode: string): Promise<boolean> {
  const hash = hashCode(rawCode);
  const rows = await query<{ id: string }>(
    "DELETE FROM mfa_recovery_codes WHERE user_id = $1 AND code_hash = $2 RETURNING id",
    [userId, hash]
  );
  return rows.length > 0;
}

export async function deleteAllRecoveryCodes(userId: string): Promise<void> {
  await query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [userId]);
}
