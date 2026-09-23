import type { AdminOrder } from "./api";

export type Granularity = "daily" | "weekly" | "monthly";

export interface SalesPoint {
  label: string;
  revenue: number; // TZS — exact total charged (order.total_tzs), not cents-converted
  orders: number;
}

/**
 * Builds a sales series for the dashboard chart.
 * - Real order dates are bucketed when present (they anchor the totals).
 * - Revenue uses each order's authoritative total_tzs (migration 0017: the
 *   exact TZS the customer was charged) so COD orders with a round-TZS
 *   transport fee are reported exactly, not via the rounded cents ledger.
 */
export function buildSalesSeries(
  orders: AdminOrder[],
  granularity: Granularity
): SalesPoint[] {
  const days = granularity === "daily" ? 14 : granularity === "weekly" ? 8 : 12;

  const buckets: { label: string; idx: number; rngFrom: number; rngTo: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    let label: string;
    let rngFrom: number;
    let rngTo: number;
    let idx: number;
    if (granularity === "daily") {
      d.setDate(d.getDate() - i);
      label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      rngFrom = d.getTime() - 3600_000;
      rngTo = d.getTime() + 86400_000;
      idx = Math.floor(d.getTime() / 86400_000);
    } else if (granularity === "weekly") {
      // last N week-starts (Monday)
      const day = (d.getDay() + 6) % 7; // Mon=0
      d.setDate(d.getDate() - day - i * 7);
      label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      rngFrom = d.getTime() - 3600_000;
      rngTo = d.getTime() + 7 * 86400_000;
      idx = Math.floor(d.getTime() / (7 * 86400_000));
    } else {
      d.setMonth(d.getMonth() - i);
      label = d.toLocaleDateString("en-US", { month: "short" });
      const y = d.getFullYear();
      rngFrom = new Date(y, d.getMonth(), 1).getTime();
      rngTo = new Date(y, d.getMonth() + 1, 1).getTime();
      idx = y * 12 + d.getMonth();
    }
    buckets.push({ label, idx, rngFrom, rngTo });
  }

  const points = buckets.map((b) => ({ ...b, revenue: 0, orders: 0 }));
  for (const o of orders) {
    const t = new Date(o.createdAt).getTime();
    const p = points.find((x) => x.idx === Math.floor(t / (granularity === "monthly" ? 1 : granularity === "weekly" ? 7 * 86400_000 : 86400_000)));
    if (p) {
      p.revenue += o.totalTzs ?? (o.totalCents ?? 0) * 27;
      p.orders += 1;
    }
  }

  // Honest series: real revenue/order counts only. Never invent numbers for
  // empty buckets — an empty chart is the correct representation of no sales.
  return points.map((p) => ({ label: p.label, revenue: p.revenue, orders: p.orders }));
}

export function ordersByStatusData(counts: Record<string, number>) {
  const COLORS: Record<string, string> = {
    PENDING: "#d01345",
    PAID: "#018849",
    SHIPPED: "#b09a5a",
    DELIVERED: "#111111",
    CANCELLED: "#9aa0a8",
  };
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) {
    // No real orders yet — show an empty-state baseline derived from the store.
    return [];
  }
  return entries.map(([name, value]) => ({ name, value, color: COLORS[name] ?? "#999" }));
}
