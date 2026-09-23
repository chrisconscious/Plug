import { query, queryOne } from "../client";

export type AdminProductLimitType = "NONE" | "FIXED_TOTAL" | "FIXED_ACTIVE" | "PER_DAY" | "PER_MONTH";

export type AdminProductLimit = {
  adminUserId: string;
  limitType: AdminProductLimitType;
  maxValue: number | null;
  updatedBy: string | null;
  updatedAt: string;
};

type Row = {
  admin_user_id: string;
  limit_type: AdminProductLimitType;
  max_value: number | null;
  updated_by: string | null;
  updated_at: string;
};

const toLimit = (r: Row): AdminProductLimit => ({
  adminUserId: r.admin_user_id,
  limitType: r.limit_type,
  maxValue: r.max_value,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

/** No row means no limit — the caller (catalog.service.ts) treats this the same as an explicit NONE row. */
export async function getLimit(adminUserId: string): Promise<AdminProductLimit | null> {
  const row = await queryOne<Row>("SELECT * FROM admin_product_limits WHERE admin_user_id = $1", [adminUserId]);
  return row ? toLimit(row) : null;
}

export async function listLimits(): Promise<AdminProductLimit[]> {
  const rows = await query<Row>("SELECT * FROM admin_product_limits ORDER BY updated_at DESC");
  return rows.map(toLimit);
}

export async function setLimit(
  adminUserId: string,
  limitType: AdminProductLimitType,
  maxValue: number | null,
  updatedBy: string
): Promise<AdminProductLimit> {
  const row = await queryOne<Row>(
    `INSERT INTO admin_product_limits (admin_user_id, limit_type, max_value, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (admin_user_id) DO UPDATE SET
       limit_type = EXCLUDED.limit_type,
       max_value = EXCLUDED.max_value,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [adminUserId, limitType, maxValue, updatedBy]
  );
  return toLimit(row!);
}

/**
 * Live count, never a stored counter (see migration 0052's own comment
 * for why) — scoped by whichever window the admin's limit type actually
 * cares about: all-time, active-only, or since a rolling window start.
 */
export async function countProductsForAdmin(
  adminUserId: string,
  opts: { activeOnly?: boolean; since?: Date }
): Promise<number> {
  const conditions = ["created_by = $1"];
  const params: unknown[] = [adminUserId];
  if (opts.activeOnly) conditions.push("active = true");
  if (opts.since) {
    params.push(opts.since.toISOString());
    conditions.push(`created_at >= $${params.length}`);
  }
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM products WHERE ${conditions.join(" AND ")}`,
    params
  );
  return Number(row?.n ?? 0);
}
