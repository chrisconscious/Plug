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
import { ValidationError, NotFoundError, AuthenticationError } from "../errors";
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
  // Being signed in is enough to order: email verification is not required
  // (an unverified address still gets its reminder on the account page).
  const user = await usersRepo.findUserById(userId);
  if (!user) throw new AuthenticationError();

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
      const orderedQty = new Map<string, number>();
      for (const it of order.items) orderedQty.set(it.variantId, (orderedQty.get(it.variantId) ?? 0) + it.quantity);
      for (const v of variants) {
        // Alert once, when THIS order takes the variant across the line —
        // into low stock, or down to zero — not again on every later order
        // while it stays low (that repeated the same alert per sale).
        const before = v.stockQty + (orderedQty.get(v.id) ?? 0);
        const crossedLow = before > LOW_STOCK_THRESHOLD && v.stockQty <= LOW_STOCK_THRESHOLD;
        const soldOut = before > 0 && v.stockQty === 0;
        if (crossedLow || soldOut) {
          await notifyAdminsLowStock(nameByVariantId.get(v.id) ?? "A product", v.id, v.stockQty);
        }
      }
    } catch {
      /* best-effort — never lets a stock-notification hiccup affect the order response */
    }
  })();

  return order;
}

const LOW_STOCK_THRESHOLD = 5;

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

export type OrderCustomer = { id: string; fullName: string | null; phoneNumber: string | null; email: string | null };

export async function getOrderForAdmin(orderId: string): Promise<{ order: Order; customer: OrderCustomer | null }> {
  // No ownership check here (unlike getOrderForUser) — an admin may
  // legitimately view any customer's order; access to this function is
  // gated at the route layer by the orders.read permission instead.
  const order = await ordersRepo.getOrderById(orderId);
  if (!order) throw new NotFoundError("Order not found.");
  // Who placed it — the account's own contact details, alongside the
  // delivery contact captured in the order's address snapshot.
  const user = await usersRepo.findUserById(order.userId);
  const customer = user ? { id: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber, email: user.email } : null;
  return { order, customer };
}

export async function updateOrderStatus(
  actor: { id: string; role: Role },
  orderId: string,
  nextStatus: Order["status"]
): Promise<Order> {
  const order = await ordersRepo.updateOrderStatusTransactional(orderId, nextStatus, actor as { id: string; role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN" });
  // Tell the customer (Payment received / shipped / delivered / cancelled).
  // After the commit and best-effort, like the order-placed notice: a
  // notification hiccup must never undo a status change that already happened.
  notifyOrderStatusChanged(order.userId, order.id, order.status).catch(() => undefined);
  return order;
}
