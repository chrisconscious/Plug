import type { PoolClient } from "pg";
import { query, queryOne } from "../client";
import { ValidationError } from "../../errors";

export type CouponDiscountType = "FIXED" | "PERCENTAGE";
export type CouponScopeType = "CATEGORY" | "BRAND" | null;

export type Coupon = {
  id: string;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderCents: number;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  startsAt: string | null;
  endsAt: string | null;
  scopeType: CouponScopeType;
  scopeId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type CouponRow = {
  id: string;
  code: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_order_cents: number;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  starts_at: string | null;
  ends_at: string | null;
  scope_type: CouponScopeType;
  scope_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

const toCoupon = (r: CouponRow): Coupon => ({
  id: r.id,
  code: r.code,
  discountType: r.discount_type,
  discountValue: r.discount_value,
  minOrderCents: r.min_order_cents,
  maxRedemptions: r.max_redemptions,
  maxRedemptionsPerCustomer: r.max_redemptions_per_customer,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  scopeType: r.scope_type,
  scopeId: r.scope_id,
  active: r.active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COUPON_COLUMNS = `id, code, discount_type, discount_value, min_order_cents, max_redemptions,
  max_redemptions_per_customer, starts_at, ends_at, scope_type, scope_id, active, created_at, updated_at`;

export async function listCoupons(): Promise<Coupon[]> {
  const rows = await query<CouponRow>(`SELECT ${COUPON_COLUMNS} FROM coupons ORDER BY created_at DESC`);
  return rows.map(toCoupon);
}

export async function findCouponById(id: string): Promise<Coupon | null> {
  const row = await queryOne<CouponRow>(`SELECT ${COUPON_COLUMNS} FROM coupons WHERE id = $1`, [id]);
  return row ? toCoupon(row) : null;
}

export type CreateCouponInput = {
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderCents: number;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  startsAt: string | null;
  endsAt: string | null;
  scopeType: CouponScopeType;
  scopeId: string | null;
  createdBy: string;
};

export async function createCoupon(input: CreateCouponInput): Promise<Coupon> {
  const row = await queryOne<CouponRow>(
    `INSERT INTO coupons (code, discount_type, discount_value, min_order_cents, max_redemptions,
       max_redemptions_per_customer, starts_at, ends_at, scope_type, scope_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COUPON_COLUMNS}`,
    [
      input.code,
      input.discountType,
      input.discountValue,
      input.minOrderCents,
      input.maxRedemptions,
      input.maxRedemptionsPerCustomer,
      input.startsAt,
      input.endsAt,
      input.scopeType,
      input.scopeId,
      input.createdBy,
    ]
  );
  return toCoupon(row!);
}

export type UpdateCouponInput = Partial<Omit<CreateCouponInput, "createdBy">> & { active?: boolean };

export async function updateCoupon(id: string, patch: UpdateCouponInput): Promise<Coupon | null> {
  const colMap: Record<string, string> = {
    code: "code",
    discountType: "discount_type",
    discountValue: "discount_value",
    minOrderCents: "min_order_cents",
    maxRedemptions: "max_redemptions",
    maxRedemptionsPerCustomer: "max_redemptions_per_customer",
    startsAt: "starts_at",
    endsAt: "ends_at",
    scopeType: "scope_type",
    scopeId: "scope_id",
    active: "active",
  };
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  for (const key of Object.keys(patch) as (keyof UpdateCouponInput)[]) {
    const col = colMap[key];
    if (!col || patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${col} = $${values.length}`);
  }
  if (values.length === 0) return findCouponById(id);
  values.push(id);
  const row = await queryOne<CouponRow>(
    `UPDATE coupons SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${COUPON_COLUMNS}`,
    values
  );
  return row ? toCoupon(row) : null;
}

// ---- Order-time validation — designed to run INSIDE the caller's own transaction ----

/**
 * Locks the coupon row (SELECT ... FOR UPDATE) and returns it, or throws a
 * customer-safe ValidationError if the code doesn't exist. Called from
 * inside createOrderTransactional's own transaction so the row lock and
 * the later redemption INSERT are part of the same atomic unit — two
 * concurrent checkouts racing for the last redemption of a
 * max_redemptions-limited coupon cannot both succeed, because the second
 * one blocks on this lock until the first transaction commits (or rolls
 * back), at which point it re-evaluates the now-current redemption count.
 */
export async function lockCouponByCode(client: PoolClient, code: string): Promise<Coupon> {
  const result = await client.query<CouponRow>(
    `SELECT ${COUPON_COLUMNS} FROM coupons WHERE code = $1 FOR UPDATE`,
    [code.trim().toUpperCase()]
  );
  const row = result.rows[0];
  if (!row) throw new ValidationError("Validation failed.", { couponCode: "This coupon code doesn't exist." });
  return toCoupon(row);
}

export async function countRedemptions(client: PoolClient, couponId: string): Promise<number> {
  const result = await client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM coupon_redemptions WHERE coupon_id = $1",
    [couponId]
  );
  return Number(result.rows[0]?.n ?? 0);
}

export async function countRedemptionsByUser(client: PoolClient, couponId: string, userId: string): Promise<number> {
  const result = await client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2",
    [couponId, userId]
  );
  return Number(result.rows[0]?.n ?? 0);
}

export async function recordRedemption(
  client: PoolClient,
  input: { couponId: string; userId: string; orderId: string; discountAppliedCents: number }
): Promise<void> {
  await client.query(
    "INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_applied_cents) VALUES ($1, $2, $3, $4)",
    [input.couponId, input.userId, input.orderId, input.discountAppliedCents]
  );
}

function computeDiscountCents(coupon: Coupon, subtotalCents: number): number {
  const raw = coupon.discountType === "PERCENTAGE"
    ? Math.floor((subtotalCents * coupon.discountValue) / 100)
    : coupon.discountValue;
  return Math.min(raw, subtotalCents);
}

function assertCouponUsable(coupon: Coupon, subtotalCents: number) {
  if (!coupon.active) throw new ValidationError("Validation failed.", { couponCode: "This coupon is no longer active." });
  const now = Date.now();
  if (coupon.startsAt && now < new Date(coupon.startsAt).getTime()) {
    throw new ValidationError("Validation failed.", { couponCode: "This coupon isn't active yet." });
  }
  if (coupon.endsAt && now > new Date(coupon.endsAt).getTime()) {
    throw new ValidationError("Validation failed.", { couponCode: "This coupon has expired." });
  }
  if (subtotalCents < coupon.minOrderCents) {
    throw new ValidationError("Validation failed.", { couponCode: `This coupon requires a minimum order of TZS ${coupon.minOrderCents.toLocaleString("en-US")}.` });
  }
}

/**
 * The authoritative, transaction-scoped path — lives in the REPO layer
 * (not the service layer) specifically so orders.repo.ts can call it
 * directly without an upward repo->service dependency, which would
 * invert this codebase's established layering (services depend on
 * repos, never the reverse) and risk a circular import between
 * orders.repo.ts and coupons.service.ts. Locks the coupon row (see
 * lockCouponByCode) so concurrent checkouts racing for the last
 * redemption of a limited coupon are serialized, not both let through.
 */
export async function applyCouponWithinTransaction(
  client: PoolClient,
  code: string,
  userId: string,
  subtotalCents: number
): Promise<{ couponId: string; discountCents: number }> {
  const coupon = await lockCouponByCode(client, code);
  assertCouponUsable(coupon, subtotalCents);

  if (coupon.maxRedemptions !== null) {
    const used = await countRedemptions(client, coupon.id);
    if (used >= coupon.maxRedemptions) {
      throw new ValidationError("Validation failed.", { couponCode: "This coupon has reached its usage limit." });
    }
  }
  if (coupon.maxRedemptionsPerCustomer !== null) {
    const usedByCustomer = await countRedemptionsByUser(client, coupon.id, userId);
    if (usedByCustomer >= coupon.maxRedemptionsPerCustomer) {
      throw new ValidationError("Validation failed.", { couponCode: "You've already used this coupon the maximum number of times." });
    }
  }

  return { couponId: coupon.id, discountCents: computeDiscountCents(coupon, subtotalCents) };
}

/** Read-only preview (no lock, no redemption) — used by coupons.service.ts's previewCoupon for the checkout screen. Exported so the service layer can reuse this exact math rather than duplicate it. */
export function previewDiscountCents(coupon: Coupon, subtotalCents: number): number {
  assertCouponUsable(coupon, subtotalCents);
  return computeDiscountCents(coupon, subtotalCents);
}
