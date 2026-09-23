import { query, queryOne, withTransaction } from "../client";
import type { PaymentMethod, PaymentMethodKind } from "../types";

export type PaymentMethodRow = {
  id: string;
  kind: PaymentMethodKind;
  name: string;
  payment_number: string | null;
  fee_cents: number;
  fee_tzs: number;
  is_active: boolean;
  display_order: number;
  icon_url: string | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
};

function toPaymentMethod(r: PaymentMethodRow): PaymentMethod {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    paymentNumber: r.payment_number,
    feeCents: r.fee_cents,
    feeTzs: Number(r.fee_tzs),
    isActive: r.is_active,
    displayOrder: r.display_order,
    iconUrl: r.icon_url,
    instructions: r.instructions,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLUMNS = `
  id, kind, name, payment_number, fee_cents, fee_tzs, is_active, display_order,
  icon_url, instructions, created_at, updated_at
`;

/** Checkout's public query — only live methods, in display order. */
export async function listActivePaymentMethods(): Promise<PaymentMethod[]> {
  const rows = await query<PaymentMethodRow>(
    `SELECT ${COLUMNS} FROM payment_methods WHERE is_active = true ORDER BY display_order ASC, created_at ASC`
  );
  return rows.map(toPaymentMethod);
}

/** Admin view — every method, including inactive. */
export async function listAllPaymentMethods(): Promise<PaymentMethod[]> {
  const rows = await query<PaymentMethodRow>(
    `SELECT ${COLUMNS} FROM payment_methods ORDER BY display_order ASC, created_at ASC`
  );
  return rows.map(toPaymentMethod);
}

export async function findPaymentMethodById(id: string): Promise<PaymentMethod | null> {
  const row = await queryOne<PaymentMethodRow>(
    `SELECT ${COLUMNS} FROM payment_methods WHERE id = $1`,
    [id]
  );
  return row ? toPaymentMethod(row) : null;
}

/** Repo-internal only — never exposed via the shared PaymentMethod type, same reasoning as categories' getCategoryImageStorageKey. */
export async function getPaymentMethodIconStorageKey(id: string): Promise<string | null> {
  const row = await queryOne<{ icon_storage_key: string | null }>("SELECT icon_storage_key FROM payment_methods WHERE id = $1", [id]);
  return row?.icon_storage_key ?? null;
}

export async function setPaymentMethodIcon(id: string, url: string | null, storageKey: string | null): Promise<PaymentMethod | null> {
  const row = await queryOne<PaymentMethodRow>(
    `UPDATE payment_methods SET icon_url = $1, icon_storage_key = $2 WHERE id = $3 RETURNING ${COLUMNS}`,
    [url, storageKey, id]
  );
  return row ? toPaymentMethod(row) : null;
}

export type PaymentMethodInsertInput = {
  kind: PaymentMethodKind;
  name: string;
  paymentNumber: string | null;
  feeCents: number;
  feeTzs: number;
  isActive: boolean;
  displayOrder: number;
  instructions?: string | null;
};

export async function insertPaymentMethod(input: PaymentMethodInsertInput): Promise<PaymentMethod> {
  const row = await queryOne<PaymentMethodRow>(
    `INSERT INTO payment_methods (kind, name, payment_number, fee_cents, fee_tzs, is_active, display_order, instructions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLUMNS}`,
    [input.kind, input.name, input.paymentNumber, input.feeCents, input.feeTzs, input.isActive, input.displayOrder, input.instructions ?? null]
  );
  return toPaymentMethod(row!);
}

export type PaymentMethodPatchInput = Partial<PaymentMethodInsertInput> & {
  id: string;
};

export async function updatePaymentMethod(patch: PaymentMethodPatchInput): Promise<PaymentMethod | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const colMap: Record<string, string> = {
    kind: "kind",
    name: "name",
    paymentNumber: "payment_number",
    feeCents: "fee_cents",
    feeTzs: "fee_tzs",
    isActive: "is_active",
    displayOrder: "display_order",
    instructions: "instructions",
  };
  for (const key of Object.keys(patch) as (keyof PaymentMethodPatchInput)[]) {
    if (key === "id") continue;
    const col = colMap[key];
    if (!col || patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${col} = $${values.length}`);
  }
  if (sets.length === 0) return findPaymentMethodById(patch.id);
  values.push(patch.id);
  const row = await queryOne<PaymentMethodRow>(
    `UPDATE payment_methods SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${COLUMNS}`,
    values
  );
  return row ? toPaymentMethod(row) : null;
}

export async function deletePaymentMethod(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>("DELETE FROM payment_methods WHERE id = $1 RETURNING id", [id]);
  return !!row;
}

/**
 * Reassign contiguous display_order (0..n-1) for the given ordered id list,
 * inside a transaction so a partial failure can't strand a broken ordering.
 */
export async function reorderPaymentMethods(orderedIds: string[]): Promise<number> {
  if (orderedIds.length === 0) return 0;
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query("UPDATE payment_methods SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
    }
  });
  return orderedIds.length;
}
