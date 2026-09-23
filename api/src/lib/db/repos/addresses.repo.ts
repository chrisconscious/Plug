import { query, queryOne, withTransaction } from "../client";
import type { Address } from "../types";

type AddressRow = {
  id: string;
  user_id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  phone: string | null;
  is_default: boolean;
};

const toAddress = (r: AddressRow): Address => ({
  id: r.id,
  userId: r.user_id,
  label: r.label,
  line1: r.line1,
  line2: r.line2 ?? undefined,
  city: r.city,
  region: r.region,
  postalCode: r.postal_code,
  country: r.country,
  phone: r.phone ?? undefined,
  isDefault: r.is_default,
});

const COLUMNS = "id, user_id, label, line1, line2, city, region, postal_code, country, phone, is_default";

/**
 * Every function here takes userId and scopes its query by it — never
 * "find by address id alone." This is the actual IDOR prevention: even if
 * a customer guesses or enumerates another customer's address id, every
 * read/update/delete below simply finds no matching row (owned by a
 * DIFFERENT user_id) rather than ever touching someone else's data.
 */

export async function listAddressesForUser(userId: string): Promise<Address[]> {
  const rows = await query<AddressRow>(
    `SELECT ${COLUMNS} FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
    [userId]
  );
  return rows.map(toAddress);
}

export async function findAddressForUser(userId: string, addressId: string): Promise<Address | null> {
  const row = await queryOne<AddressRow>(`SELECT ${COLUMNS} FROM addresses WHERE id = $1 AND user_id = $2`, [addressId, userId]);
  return row ? toAddress(row) : null;
}

export async function createAddressForUser(
  userId: string,
  input: Omit<Address, "id" | "userId" | "isDefault">,
  makeDefault: boolean
): Promise<Address> {
  return withTransaction(async (client) => {
    if (makeDefault) {
      // Unset any existing default FIRST, inside the same transaction —
      // the partial unique index (migration 0048) would otherwise reject
      // inserting a second is_default=true row for this user.
      await client.query("UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default = true", [userId]);
    }
    const result = await client.query<AddressRow>(
      `INSERT INTO addresses (user_id, label, line1, line2, city, region, postal_code, country, phone, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${COLUMNS}`,
      [userId, input.label, input.line1, input.line2 ?? null, input.city, input.region, input.postalCode, input.country, input.phone ?? null, makeDefault]
    );
    return toAddress(result.rows[0]!);
  });
}

export async function updateAddressForUser(
  userId: string,
  addressId: string,
  patch: Partial<Omit<Address, "id" | "userId" | "isDefault">>
): Promise<Address | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.label !== undefined) push("label", patch.label);
  if (patch.line1 !== undefined) push("line1", patch.line1);
  if (patch.line2 !== undefined) push("line2", patch.line2 || null);
  if (patch.city !== undefined) push("city", patch.city);
  if (patch.region !== undefined) push("region", patch.region);
  if (patch.postalCode !== undefined) push("postal_code", patch.postalCode);
  if (patch.country !== undefined) push("country", patch.country);
  if (patch.phone !== undefined) push("phone", patch.phone || null);
  if (sets.length === 0) return findAddressForUser(userId, addressId);

  params.push(addressId, userId);
  const row = await queryOne<AddressRow>(
    // WHERE id = $N AND user_id = $N+1 — the ownership check is baked
    // into the UPDATE itself, not a separate "does this belong to them"
    // query beforehand (which would leave a TOCTOU gap between the check
    // and the write).
    `UPDATE addresses SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING ${COLUMNS}`,
    params
  );
  return row ? toAddress(row) : null;
}

export async function deleteAddressForUser(userId: string, addressId: string): Promise<boolean> {
  const rows = await query<{ id: string }>("DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING id", [addressId, userId]);
  return rows.length > 0;
}

export async function setDefaultAddressForUser(userId: string, addressId: string): Promise<Address | null> {
  return withTransaction(async (client) => {
    // Ownership re-verified here even though the caller already checked —
    // this function is the one place that actually mutates is_default,
    // so it re-confirms rather than trusting an earlier check that could
    // theoretically be bypassed by calling this directly.
    const owned = await client.query<{ id: string }>("SELECT id FROM addresses WHERE id = $1 AND user_id = $2", [addressId, userId]);
    if (owned.rows.length === 0) return null;
    await client.query("UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default = true", [userId]);
    const result = await client.query<AddressRow>(
      `UPDATE addresses SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
      [addressId, userId]
    );
    return result.rows[0] ? toAddress(result.rows[0]) : null;
  });
}
