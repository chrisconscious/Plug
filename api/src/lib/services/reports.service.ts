import { query, queryOne } from "../db/client";
import type { Order } from "../db/types";
import { listAuditEvents } from "../audit";

/**
 * Store reporting, computed in SQL from the real orders / order_items /
 * products / users tables — never from a capped page of rows, never from
 * numbers kept in the UI.
 *
 * Definitions used everywhere (dashboard, Reports page, CSV export):
 * - "Sales" / order value: orders that were placed and NOT cancelled.
 * - "Paid revenue": orders the store has confirmed as paid
 *   (PAID, SHIPPED, DELIVERED). Pending orders are not revenue yet.
 * - Amounts are the TZS each order was actually charged (orders.total_tzs).
 * - Days/weeks/months are bucketed in the store's own timezone.
 */
const STORE_TZ = process.env.STORE_TIMEZONE || "Africa/Dar_es_Salaam";
const PAID = ["PAID", "SHIPPED", "DELIVERED"];
export const LOW_STOCK_THRESHOLD = 5;

export type Granularity = "daily" | "weekly" | "monthly";
const PERIODS: Record<Granularity, { unit: "day" | "week" | "month"; count: number }> = {
  daily: { unit: "day", count: 14 },
  weekly: { unit: "week", count: 8 },
  monthly: { unit: "month", count: 12 },
};

export function parseGranularity(v: string | null | undefined): Granularity {
  return v === "weekly" || v === "monthly" ? v : "daily";
}

export async function getSalesReport(granularity: Granularity) {
  const { unit, count } = PERIODS[granularity];
  const tz = STORE_TZ;

  // Every bucket in the window (so empty periods show as 0, not missing),
  // joined to the orders that fall in it.
  const series = await query<{ bucket: string; orders: number; valueTzs: string; paidTzs: string }>(
    `WITH buckets AS (
       SELECT generate_series(
                date_trunc($1, now() AT TIME ZONE $3) - ($2::int - 1) * ('1 ' || $1)::interval,
                date_trunc($1, now() AT TIME ZONE $3),
                ('1 ' || $1)::interval
              ) AS bucket
     )
     SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket,
            COUNT(o.id) FILTER (WHERE o.status <> 'CANCELLED')::int AS orders,
            COALESCE(SUM(o.total_tzs) FILTER (WHERE o.status <> 'CANCELLED'), 0)::text AS "valueTzs",
            COALESCE(SUM(o.total_tzs) FILTER (WHERE o.status = ANY($4::text[])), 0)::text AS "paidTzs"
       FROM buckets b
       LEFT JOIN orders o ON date_trunc($1, o.created_at AT TIME ZONE $3) = b.bucket
      GROUP BY b.bucket
      ORDER BY b.bucket`,
    [unit, count, tz, PAID]
  );
  const from = series[0]?.bucket ?? null;

  const [summary, statusRows, topProducts, paymentMethods] = await Promise.all([
    queryOne<{ orders: number; cancelled: number; valueTzs: string; paidTzs: string; pendingTzs: string; newCustomers: number }>(
      `SELECT COUNT(*) FILTER (WHERE o.status <> 'CANCELLED')::int AS orders,
              COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
              COALESCE(SUM(o.total_tzs) FILTER (WHERE o.status <> 'CANCELLED'), 0)::text AS "valueTzs",
              COALESCE(SUM(o.total_tzs) FILTER (WHERE o.status = ANY($3::text[])), 0)::text AS "paidTzs",
              COALESCE(SUM(o.total_tzs) FILTER (WHERE o.status = 'PENDING'), 0)::text AS "pendingTzs",
              (SELECT COUNT(*)::int FROM users u WHERE u.role = 'CUSTOMER' AND (u.created_at AT TIME ZONE $2)::date >= $1::date) AS "newCustomers"
         FROM orders o
        WHERE (o.created_at AT TIME ZONE $2)::date >= $1::date`,
      [from, tz, PAID]
    ),
    query<{ status: Order["status"]; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM orders WHERE (created_at AT TIME ZONE $2)::date >= $1::date GROUP BY status`,
      [from, tz]
    ),
    query<{ productId: string | null; name: string; units: number; valueTzs: string }>(
      `SELECT oi.product_id AS "productId", MAX(oi.name_snapshot) AS name,
              SUM(oi.quantity)::int AS units, SUM(oi.line_total_cents)::text AS "valueTzs"
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status <> 'CANCELLED' AND (o.created_at AT TIME ZONE $2)::date >= $1::date
        GROUP BY oi.product_id
        ORDER BY units DESC, SUM(oi.line_total_cents) DESC
        LIMIT 10`,
      [from, tz]
    ),
    query<{ name: string; orders: number; valueTzs: string }>(
      `SELECT COALESCE(o.payment_method_name, 'Not recorded') AS name, COUNT(*)::int AS orders,
              COALESCE(SUM(o.total_tzs), 0)::text AS "valueTzs"
         FROM orders o
        WHERE o.status <> 'CANCELLED' AND (o.created_at AT TIME ZONE $2)::date >= $1::date
        GROUP BY 1 ORDER BY orders DESC`,
      [from, tz]
    ),
  ]);

  const orders = summary?.orders ?? 0;
  const valueTzs = Number(summary?.valueTzs ?? 0);
  return {
    granularity,
    timezone: tz,
    from,
    summary: {
      orders,
      cancelledOrders: summary?.cancelled ?? 0,
      orderValueTzs: valueTzs,
      paidRevenueTzs: Number(summary?.paidTzs ?? 0),
      pendingValueTzs: Number(summary?.pendingTzs ?? 0),
      averageOrderValueTzs: orders > 0 ? Math.round(valueTzs / orders) : 0,
      newCustomers: summary?.newCustomers ?? 0,
    },
    series: series.map((r) => ({ bucket: r.bucket, orders: r.orders, orderValueTzs: Number(r.valueTzs), paidRevenueTzs: Number(r.paidTzs) })),
    statusCounts: Object.fromEntries(statusRows.map((r) => [r.status, r.n])) as Partial<Record<Order["status"], number>>,
    topProducts: topProducts.map((p) => ({ productId: p.productId, name: p.name, units: p.units, valueTzs: Number(p.valueTzs) })),
    paymentMethods: paymentMethods.map((m) => ({ name: m.name, orders: m.orders, valueTzs: Number(m.valueTzs) })),
  };
}

/** Variants at or under the low-stock line on products that are live, lowest first. */
export async function getLowStock(limit = 15) {
  return query<{ variantId: string; productId: string; productName: string; size: string; color: string; stockQty: number }>(
    `SELECT v.id AS "variantId", p.id AS "productId", p.name AS "productName", v.size, v.color, v.stock_qty AS "stockQty"
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE p.active = true AND p.archived_at IS NULL AND v.stock_qty <= $1
      ORDER BY v.stock_qty ASC, p.name ASC
      LIMIT $2`,
    [LOW_STOCK_THRESHOLD, limit]
  );
}

/** Dashboard headline numbers — all-time, SQL aggregates (no row caps). */
export async function getDashboardStats() {
  const [counts, orderAgg, statusRows, recent, topCustomers, recentCustomers, lowStock, events] = await Promise.all([
    queryOne<{ customers: number; admins: number; users: number; products: number; liveProducts: number; categories: number; brands: number; variants: number; lowStock: number; outOfStock: number }>(
      `SELECT (SELECT COUNT(*) FROM users WHERE role = 'CUSTOMER')::int AS customers,
              (SELECT COUNT(*) FROM users WHERE role IN ('ADMIN','SUPER_ADMIN'))::int AS admins,
              (SELECT COUNT(*) FROM users)::int AS users,
              (SELECT COUNT(*) FROM products WHERE archived_at IS NULL)::int AS products,
              (SELECT COUNT(*) FROM products WHERE active = true AND archived_at IS NULL)::int AS "liveProducts",
              (SELECT COUNT(*) FROM categories)::int AS categories,
              (SELECT COUNT(*) FROM brands)::int AS brands,
              (SELECT COUNT(*) FROM product_variants)::int AS variants,
              (SELECT COUNT(*) FROM product_variants v JOIN products p ON p.id = v.product_id
                WHERE p.active AND p.archived_at IS NULL AND v.stock_qty > 0 AND v.stock_qty <= $1)::int AS "lowStock",
              (SELECT COUNT(*) FROM product_variants v JOIN products p ON p.id = v.product_id
                WHERE p.active AND p.archived_at IS NULL AND v.stock_qty = 0)::int AS "outOfStock"`,
      [LOW_STOCK_THRESHOLD]
    ),
    queryOne<{ orders: number; valueTzs: string; paidTzs: string; pending: number }>(
      `SELECT COUNT(*) FILTER (WHERE status <> 'CANCELLED')::int AS orders,
              COALESCE(SUM(total_tzs) FILTER (WHERE status <> 'CANCELLED'), 0)::text AS "valueTzs",
              COALESCE(SUM(total_tzs) FILTER (WHERE status = ANY($1::text[])), 0)::text AS "paidTzs",
              COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending
         FROM orders`,
      [PAID]
    ),
    query<{ status: Order["status"]; n: number }>("SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status"),
    query<{ id: string; status: Order["status"]; totalTzs: string; createdAt: string; items: number; firstItem: string | null; customer: string | null }>(
      `SELECT o.id, o.status, o.total_tzs::text AS "totalTzs", o.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS items,
              (SELECT oi.name_snapshot FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id LIMIT 1) AS "firstItem",
              COALESCE(u.full_name, u.phone_number, u.email) AS customer
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC LIMIT 6`
    ),
    query<{ id: string; name: string | null; orders: number; spentTzs: string }>(
      `SELECT u.id, COALESCE(u.full_name, u.phone_number, u.email) AS name,
              COUNT(o.id)::int AS orders, COALESCE(SUM(o.total_tzs), 0)::text AS "spentTzs"
         FROM users u JOIN orders o ON o.user_id = u.id AND o.status <> 'CANCELLED'
        WHERE u.role = 'CUSTOMER'
        GROUP BY u.id ORDER BY SUM(o.total_tzs) DESC LIMIT 5`
    ),
    query<{ id: string; name: string | null; createdAt: string }>(
      `SELECT id, COALESCE(full_name, phone_number, email) AS name, created_at AS "createdAt"
         FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`
    ),
    getLowStock(8),
    listAuditEvents(6),
  ]);

  return {
    totals: {
      users: counts?.users ?? 0,
      admins: counts?.admins ?? 0,
      customers: counts?.customers ?? 0,
      products: counts?.products ?? 0,
      liveProducts: counts?.liveProducts ?? 0,
      categories: counts?.categories ?? 0,
      brands: counts?.brands ?? 0,
      variants: counts?.variants ?? 0,
      lowStockVariants: counts?.lowStock ?? 0,
      outOfStockVariants: counts?.outOfStock ?? 0,
      orders: orderAgg?.orders ?? 0,
      pendingOrders: orderAgg?.pending ?? 0,
      orderValueTzs: Number(orderAgg?.valueTzs ?? 0),
      paidRevenueTzs: Number(orderAgg?.paidTzs ?? 0),
    },
    orderStatusCounts: Object.fromEntries(statusRows.map((r) => [r.status, r.n])) as Partial<Record<Order["status"], number>>,
    recentOrders: recent.map((o) => ({ ...o, totalTzs: Number(o.totalTzs) })),
    topCustomers: topCustomers.map((c) => ({ ...c, spentTzs: Number(c.spentTzs) })),
    recentCustomers,
    lowStock,
    recentEvents: events,
  };
}
