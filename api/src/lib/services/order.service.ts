/**
 * Thin orchestration layer over db/repos/orders.repo.ts, which now holds
 * the actual transactional/concurrency-safe logic (real `SELECT ... FOR
 * UPDATE` row locks and a database-enforced idempotency key, both
 * described in detail in orders.repo.ts's header comment) — this
 * supersedes the Phase 1 in-memory mutex + in-memory idempotency Map
 * approach, which only worked correctly for a single process.
 */
import * as ordersRepo from "../db/repos/orders.repo";
import * as usersRepo from "../db/repos/users.repo";
import * as catalogRepo from "../db/repos/catalog.repo";
import { notifyOrderStatusChanged, notifyAdminsNewOrder, notifyAdminsLowStock } from "./notifications.service";
import { ValidationError, NotFoundError, EmailNotVerifiedError, AuthenticationError } from "../errors";
import type { Order, Address } from "../db/types";
import type { Role } from "../rbac";
import { createHash } from "crypto";

/**
 * A stable fingerprint of the fields that actually define "what this
 * checkout request is asking for" — used to detect an idempotency key
 * being reused for a genuinely DIFFERENT request (see orders.repo.ts's
 * createOrderTransactional and migration 0027). Deliberately built from
 * explicit, known fields in a FIXED order rather than a generic
 * JSON.stringify(shippingAddress) — object key insertion order isn't
 * guaranteed to be identical between two logically-identical requests
 * (e.g. if the client constructs the object differently), which would
 * cause two matching addresses to hash differently and wrongly look like
 * "different requests."
 */
function fingerprintOrderRequest(
  shippingAddress: Omit<Address, "id" | "userId">,
  paymentMethodId: string,
  transportPaymentNumber: string | null,
  deliveryLocation: string,
  directItems?: ReadonlyArray<{ variantId: string; quantity: number }> | null,
  couponCode?: string | null
): string {
  const canonical = [
    shippingAddress.label,
    shippingAddress.line1,
    shippingAddress.line2 ?? "",
    shippingAddress.city,
    shippingAddress.region,
    shippingAddress.postalCode,
    shippingAddress.country,
    shippingAddress.phone ?? "",
    paymentMethodId,
    transportPaymentNumber ?? "",
    deliveryLocation,
    // Same reasoning as directItems below — a reused idempotency key
    // with a DIFFERENT coupon code must hash differently, or a second
    // request accidentally/deliberately omitting a coupon could be
    // silently answered with the first request's (different) order.
    "coupon:" + (couponCode ?? ""),
  ];
  // "Buy it now" — a direct item list overrides the cart — is part of what
  // defines this request. Two different buy-now checkouts sharing one
  // idempotency key must hash differently (same reasoning as the address
  // fields above); WITHOUT this, a reused key for a different product
  // would be silently answered with the earlier product's order.
  if (directItems && directItems.length > 0) {
    canonical.push(
      "direct:" +
        [...directItems]
          .map((i) => `${i.variantId}:${i.quantity}`)
          .sort()
          .join("|")
    );
  }
  return createHash("sha256").update(canonical.join("\u0000")).digest("hex");
}

export async function createOrderFromCart(
  userId: string,
  shippingAddress: Omit<Address, "id" | "userId">,
  idempotencyKey: string | null,
  paymentMethodId: string,
  transportPaymentNumber: string | null,
  deliveryLocation: unknown,
  directItems?: ReadonlyArray<{ variantId: string; quantity: number }> | null,
  couponCode?: string | null
): Promise<Order> {
  // Verified checked here (not only at registration) so it's always the
  // account's CURRENT status — e.g. right after they click the email link,
  // the very next order attempt succeeds with no need to log out/in again.
  // Only enforced for accounts that actually HAVE an email to verify —
  // a phone-registered account (migration 0037) has no email at all, so
  // gating on emailVerified unconditionally would have permanently
  // blocked every phone-only customer from ever placing an order, since
  // there would be no way for them to ever satisfy the check.
  const user = await usersRepo.findUserById(userId);
  if (!user) throw new AuthenticationError();
  if (user.email && !user.emailVerified) {
    throw new EmailNotVerifiedError("Please verify your email address before placing an order.");
  }

  if (!idempotencyKey) {
    throw new ValidationError("Validation failed.", {
      "Idempotency-Key": "This header is required for order creation.",
    });
  }
  if (!paymentMethodId) {
    throw new ValidationError("Validation failed.", {
      paymentMethodId: "Please select a payment method.",
    });
  }
  if (deliveryLocation !== "dar_es_salaam" && deliveryLocation !== "outside_dar") {
    throw new ValidationError("Validation failed.", {
      deliveryLocation: "Select a delivery location (Dar es Salaam or outside Dar es Salaam).",
    });
  }
  const requestFingerprint = fingerprintOrderRequest(shippingAddress, paymentMethodId, transportPaymentNumber, deliveryLocation, directItems, couponCode);
  const order = await ordersRepo.createOrderTransactional(userId, idempotencyKey, shippingAddress, paymentMethodId, transportPaymentNumber, requestFingerprint, deliveryLocation, directItems ?? null, couponCode ?? null);

  // Notifications are fired AFTER the transaction commits, deliberately
  // outside it — a notification failure (or the notifications table
  // being briefly unavailable) must never roll back a successful,
  // already-paid-for order. Best-effort: swallow and continue either way.
  notifyOrderStatusChanged(userId, order.id, order.status).catch(() => undefined);
  notifyAdminsNewOrder(order.id, order.totalTzs ?? order.totalCents).catch(() => undefined);

  // Low/out-of-stock check — re-fetches the CURRENT stock for exactly the
  // variants in this order (a small, bounded set, not a table scan) now
  // that the transaction has actually decremented it. A threshold of 5
  // matches the document's own "only 3 items remaining" example; this
  // fires at most once per order per affected variant, not once per
  // unit purchased.
  (async () => {
    try {
      const variantIds = [...new Set(order.items.map((it) => it.variantId))];
      const variants = await catalogRepo.findVariantsByIds(variantIds);
      const nameByVariantId = new Map(order.items.map((it) => [it.variantId, it.nameSnapshot]));
      for (const v of variants) {
        if (v.stockQty <= 5) {
          await notifyAdminsLowStock(nameByVariantId.get(v.id) ?? "A product", v.id, v.stockQty);
        }
      }
    } catch {
      /* best-effort — never lets a stock-notification hiccup affect the order response */
    }
  })();

  return order;
}

export async function getOrderForUser(userId: string, orderId: string): Promise<Order> {
  const order = await ordersRepo.getOrderById(orderId);
  if (!order) throw new NotFoundError("Order not found.");
  // Ownership check — another customer's order answers exactly like a missing one (404), so order ids can't be probed.
  if (order.userId !== userId) throw new NotFoundError("Order not found.");
  return order;
}

export async function listOrdersForUser(userId: string): Promise<Order[]> {
  return ordersRepo.listOrdersForUser(userId);
}

// ---- Admin (RBAC-gated in the route layer) ----

export async function listAllOrders(): Promise<Order[]> {
  return ordersRepo.listAllOrders();
}

export async function getOrderForAdmin(orderId: string): Promise<Order> {
  // No ownership check here (unlike getOrderForUser) — an admin may
  // legitimately view any customer's order; access to this function is
  // gated at the route layer by the orders.read permission instead.
  const order = await ordersRepo.getOrderById(orderId);
  if (!order) throw new NotFoundError("Order not found.");
  return order;
}

export async function updateOrderStatus(
  actor: { id: string; role: Role },
  orderId: string,
  nextStatus: Order["status"]
): Promise<Order> {
  return ordersRepo.updateOrderStatusTransactional(orderId, nextStatus, actor as { id: string; role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN" });
}
