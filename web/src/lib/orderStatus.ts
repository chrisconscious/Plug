import type { Order } from "./api";

/**
 * Customer-facing names for the order statuses the API actually has — one
 * map for every page, so a status never reads differently on the account
 * page, the order list, the order page and the admin view.
 */
export const ORDER_STATUS_LABEL: Record<Order["status"], string> = {
  PENDING: "Pending",
  PAID: "Paid",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status as Order["status"]] ?? status;
}

/** Short reference shown to customers and used when they contact support. */
export function orderRef(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

/** "Classic Tee (Black, M)" — only the variant details that exist. */
export function itemSummary(it: { nameSnapshot: string; color?: string | null; size?: string | null }): string {
  const variant = [it.color, it.size].filter((v) => v && v.trim()).join(", ");
  return variant ? `${it.nameSnapshot} (${variant})` : it.nameSnapshot;
}
