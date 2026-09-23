import * as notificationsRepo from "../db/repos/notifications.repo";
import type { NotificationCategory } from "../db/repos/notifications.repo";
import type { Role } from "../rbac";
import { ValidationError, NotFoundError } from "../errors";
import { recordAuditEvent } from "../audit";

export async function listMyNotifications(userId: string, role: Role, page?: number, pageSize?: number) {
  return notificationsRepo.listNotificationsForUser(userId, role, { page, pageSize });
}

export async function getMyUnreadCount(userId: string, role: Role): Promise<number> {
  return notificationsRepo.getUnreadCountForUser(userId, role);
}

export async function markMyNotificationRead(userId: string, role: Role, notificationId: string) {
  const ok = await notificationsRepo.markNotificationRead(userId, role, notificationId);
  if (!ok) throw new NotFoundError("Notification not found.");
}

export async function markAllMyNotificationsRead(userId: string, role: Role) {
  await notificationsRepo.markAllReadForUser(userId, role);
}

// ---- Internal creation helpers — called from other services at the actual event, never from a route taking a raw recipient id from the client. ----

export async function notifyUser(input: {
  userId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  imageUrl?: string | null;
}) {
  await notificationsRepo.createNotification({ ...input, userId: input.userId });
}

export async function notifyRole(input: {
  roleScope: Role;
  category: NotificationCategory;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  imageUrl?: string | null;
}) {
  await notificationsRepo.createNotification({ ...input, roleScope: input.roleScope });
}

// ---- Order lifecycle — the actual notification text lives HERE, once, rather than being duplicated at every call site in order.service.ts. ----

const ORDER_STATUS_COPY: Record<string, { title: string; message: (orderNumber: string) => string }> = {
  PENDING: { title: "Order placed", message: (n) => `Your order #${n} has been placed and is awaiting confirmation.` },
  PAID: { title: "Payment received", message: (n) => `Payment for order #${n} has been confirmed.` },
  SHIPPED: { title: "Order shipped", message: (n) => `Order #${n} is on its way.` },
  DELIVERED: { title: "Order delivered", message: (n) => `Order #${n} has been delivered. We hope you love it.` },
  CANCELLED: { title: "Order cancelled", message: (n) => `Order #${n} has been cancelled.` },
};

export async function notifyOrderStatusChanged(userId: string, orderId: string, status: string) {
  const copy = ORDER_STATUS_COPY[status];
  if (!copy) return; // an unrecognized/internal-only status is deliberately silent
  const orderNumber = orderId.slice(0, 8).toUpperCase();
  await notifyUser({
    userId,
    category: status === "PAID" ? "PAYMENT" : "ORDER",
    title: copy.title,
    message: copy.message(orderNumber),
    entityType: "order",
    entityId: orderId,
    actionUrl: `/orders/${orderId}`,
  });
}

export async function notifyAdminsNewOrder(orderId: string, totalTzs: number) {
  const orderNumber = orderId.slice(0, 8).toUpperCase();
  await notifyRole({
    roleScope: "ADMIN",
    category: "ORDER",
    title: "New order received",
    message: `Order #${orderNumber} has been placed — TZS ${totalTzs.toLocaleString("en-US")}.`,
    entityType: "order",
    entityId: orderId,
    actionUrl: `/admin/orders/${orderId}`,
  });
}

export async function notifyAdminsLowStock(productName: string, variantId: string, stockQty: number) {
  await notifyRole({
    roleScope: "ADMIN",
    category: "INVENTORY",
    title: stockQty === 0 ? "Product out of stock" : "Low stock",
    message: stockQty === 0 ? `${productName} is now out of stock.` : `${productName} — only ${stockQty} item${stockQty === 1 ? "" : "s"} remaining.`,
    entityType: "product_variant",
    entityId: variantId,
  });
}

/**
 * Fired when a PRODUCT that was entirely sold out (every variant at 0)
 * gets at least one variant restocked — not on every individual variant
 * change, which would spam a customer every time any one size/color of
 * an already-available product got a minor stock adjustment. See
 * catalog.service.ts's replaceProductVariants for where this is called,
 * with the actual before/after comparison that decides whether this
 * genuinely qualifies as "back in stock."
 */
export async function notifyWishlistersProductBackInStock(userIds: string[], productId: string, productName: string, productSlug: string) {
  await Promise.all(
    userIds.map((userId) =>
      notifyUser({
        userId,
        category: "WISHLIST",
        title: "Back in stock",
        message: `${productName}, saved to your wishlist, is back in stock.`,
        entityType: "product",
        entityId: productId,
        actionUrl: `/product/${productSlug}`,
      }).catch(() => undefined)
    )
  );
}

// ---- Admin/Superadmin promotional & broadcast management ----

export async function listBroadcasts() {
  return notificationsRepo.listBroadcastNotifications();
}

export async function createBroadcast(actor: { id: string; role: Role }, input: {
  roleScope?: unknown;
  title?: unknown;
  message?: unknown;
  actionUrl?: unknown;
  imageUrl?: unknown;
}) {
  const roleScope = input.roleScope;
  if (roleScope !== "CUSTOMER" && roleScope !== "ADMIN" && roleScope !== "SUPER_ADMIN") {
    throw new ValidationError("Validation failed.", { roleScope: "Choose a valid target audience." });
  }
  if (typeof input.title !== "string" || !input.title.trim()) {
    throw new ValidationError("Validation failed.", { title: "Enter a title." });
  }
  if (typeof input.message !== "string" || !input.message.trim()) {
    throw new ValidationError("Validation failed.", { message: "Enter a message." });
  }
  if (input.actionUrl !== undefined && input.actionUrl !== null && typeof input.actionUrl !== "string") {
    throw new ValidationError("Validation failed.", { actionUrl: "Must be a string or empty." });
  }
  const id = await notificationsRepo.createNotification({
    roleScope,
    category: "PROMOTION",
    title: input.title.trim(),
    message: input.message.trim(),
    actionUrl: typeof input.actionUrl === "string" && input.actionUrl.trim() ? input.actionUrl.trim() : null,
    imageUrl: typeof input.imageUrl === "string" && input.imageUrl.trim() ? input.imageUrl.trim() : null,
    createdBy: actor.id,
  });
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "notification.broadcast_created", targetType: "notification", targetId: id, metadata: { roleScope } });
  return id;
}

export async function setBroadcastActive(actor: { id: string; role: Role }, id: string, active: boolean) {
  const ok = await notificationsRepo.setBroadcastActive(id, active);
  if (!ok) throw new NotFoundError("Broadcast notification not found.");
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: active ? "notification.broadcast_activated" : "notification.broadcast_deactivated", targetType: "notification", targetId: id });
}
