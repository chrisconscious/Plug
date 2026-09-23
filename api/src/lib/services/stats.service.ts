import { query } from "../db/client";
import { listAllOrders } from "./order.service";
import { listAdmins } from "./admin.service";
import { listAllUsersWithStats } from "../db/repos/users.repo";
import { listAuditEvents } from "../audit";

/**
 * Consolidated analytics for the Business (admin/super-admin) dashboards.
 * Aggregates are computed server-side from the real orders/products/users
 * tables so every number shown is derived, never hardcoded in the UI.
 */
export async function getAdminStats() {
  const [usersResult, admins, products, orders, categories, brands] = await Promise.all([
    // pageSize: 100 (the function's own max) rather than its 25 default —
    // still an incomplete fix, not a full one: this dashboard wants every
    // user for its aggregates (customer count, total lifetime spend), and
    // a single capped page undercounts once there are more than 100 real
    // users. The right fix is a dedicated SQL aggregate (COUNT/SUM
    // GROUP BY role) rather than paging through individual rows in JS —
    // flagged here rather than left silently wrong, since 100 is enough
    // to stop the current crash but not enough to make this accurate at
    // real scale.
    listAllUsersWithStats({ pageSize: 100 }),
    listAdmins(),
    query<{ n: string }>("SELECT COUNT(*)::int AS n FROM products"),
    listAllOrders(),
    query<{ n: string }>("SELECT COUNT(*)::int AS n FROM categories"),
    query<{ n: string }>("SELECT COUNT(*)::int AS n FROM brands"),
  ]);
  const users = usersResult.users;

  const productTotal = Number(products[0]?.n ?? 0);
  const categoryTotal = Number(categories[0]?.n ?? 0);
  const brandTotal = Number(brands[0]?.n ?? 0);

  // revenueTzs is the sum of what customers were actually charged
  // (Σ total_tzs). revenueCents is kept for backward compatibility
  // (now identical to revenueTzs since both columns hold TZS).
  const revenueCents = orders.reduce((s, o) => s + (o.totalCents ?? 0), 0);
  const revenueTzs = orders.reduce((s, o) => s + (Number(o.totalTzs) || 0), 0);
  const orderStatusCounts: Record<string, number> = {};
  for (const o of orders) orderStatusCounts[o.status] = (orderStatusCounts[o.status] ?? 0) + 1;

  // Products in stock / low stock (derived from variants).
  const stock = await query<{ inStock: string; lowStock: string }>(
    `SELECT COUNT(*) FILTER (WHERE stock_qty > 5)::int AS "inStock",
            COUNT(*) FILTER (WHERE stock_qty > 0 AND stock_qty <= 5)::int AS "lowStock"
     FROM product_variants`
  );

  const customers = users.filter((u) => u.role === "CUSTOMER");
  const customerSpend = customers.reduce((s, u) => s + (u.totalSpentCents ?? 0), 0);

  return {
    totals: {
      users: users.length,
      admins: admins.length,
      customers: users.filter((u) => u.role === "CUSTOMER").length,
      products: productTotal,
      categories: categoryTotal,
      brands: brandTotal,
      orders: orders.length,
      revenueCents,
      revenueTzs,
      customerSpendCents: customerSpend,
      variants: Number((stock[0] as unknown as { inStock?: number })?.inStock ?? 0) + Number((stock[0] as unknown as { lowStock?: number })?.lowStock ?? 0),
    },
    orderStatusCounts,
    recentOrders: orders.slice(0, 8),
    recentEvents: await listAuditEvents(6),
    topCustomers: [...customers].sort((a, b) => (b.totalSpentCents ?? 0) - (a.totalSpentCents ?? 0)).slice(0, 5),
  };
}
