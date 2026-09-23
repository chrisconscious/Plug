/**
 * Order creation is the single most integrity-critical write path in the
 * platform. Every step below runs inside ONE database transaction
 * (`withTransaction`), and the inventory check-and-decrement runs against
 * rows locked with `SELECT ... FOR UPDATE` — this is the real mechanism
 * that a Phase 1 in-memory mutex (since removed — it was a faithful
 * single-process stand-in for exactly this, but is unused now) provided.
 * See docs/DATABASE.md "Concurrency strategy" for the full reasoning,
 * including why locks are acquired in a stable
 * `ORDER BY pv.id` to avoid deadlocking against another concurrent order
 * that touches an overlapping set of variants.
 *
 * Idempotency is enforced by the database itself: `idempotency_keys` has a
 * composite PRIMARY KEY (scope, user_id, idempotency_key) (migration 0005),
 * and the claiming INSERT happens INSIDE the same transaction as the rest
 * of order creation. That means:
 *   - If the whole transaction fails for any reason (out of stock, etc.),
 *     the idempotency claim rolls back too — a failed attempt never
 *     permanently blocks a legitimate retry with the same key.
 *   - If two requests race with the same key, the loser's INSERT hits a
 *     23505 unique-violation immediately (before any inventory work
 *     happens), and the outer function looks up the winner's row (in a
 *     fresh query, since the loser's own transaction already aborted) to
 *     return its result or report "still in progress."
 * This is a strictly better mechanism than the Phase 1 in-memory Map: it
 * works correctly across multiple backend instances, not just one process.
 */
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction, isPgErrorCode, PG_ERROR_CODES } from "../client";
import { ConflictError, ValidationError } from "../../errors";
import { recordAuditEventOnClient } from "./audit.repo";
import * as couponsRepo from "./coupons.repo";
import type { Order, OrderItem, Address } from "../types";

type OrderRow = {
  id: string;
  user_id: string;
  status: Order["status"];
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  total_tzs: Order["totalTzs"];
  shipping_address_snapshot: Order["shippingAddressSnapshot"];
  payment_method_kind: Order["paymentMethodKind"];
  payment_method_name: Order["paymentMethodName"];
  payment_number: Order["paymentNumber"];
  transport_fee_cents: Order["transportFeeCents"];
  transport_fee_tzs: Order["transportFeeTzs"];
  transport_payment_number: Order["transportPaymentNumber"];
  transport_payment_name: Order["transportPaymentName"];
  delivery_location: Order["deliveryLocation"];
  created_at: string;
};

type OrderItemRow = {
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  name_snapshot: string;
  brand_snapshot: string;
  size: string;
  color: string;
  unit_price_cents_snapshot: number;
  quantity: number;
  line_total_cents: number;
};

function toOrderItem(row: OrderItemRow): OrderItem {
  return {
    productId: row.product_id ?? "",
    variantId: row.variant_id ?? "",
    nameSnapshot: row.name_snapshot,
    brandSnapshot: row.brand_snapshot,
    size: row.size,
    color: row.color,
    unitPriceCentsSnapshot: row.unit_price_cents_snapshot,
    quantity: row.quantity,
    lineTotalCents: row.line_total_cents,
  };
}

function toOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    items,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    totalTzs: Number(row.total_tzs),
    shippingAddressSnapshot: row.shipping_address_snapshot,
    paymentMethodKind: row.payment_method_kind,
    paymentMethodName: row.payment_method_name,
    paymentNumber: row.payment_number,
    transportFeeCents: row.transport_fee_cents,
    transportFeeTzs: Number(row.transport_fee_tzs),
    transportPaymentNumber: row.transport_payment_number,
    transportPaymentName: row.transport_payment_name,
    deliveryLocation: row.delivery_location,
    createdAt: row.created_at,
  };
}

/** Internal control-flow signal only — never escapes this file. */
class IdempotencyKeyClaimConflict extends Error {}

async function fetchOrderWithItems(orderId: string): Promise<Order | null> {
  const orderRow = await queryOne<OrderRow>("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!orderRow) return null;
  const itemRows = await query<OrderItemRow>("SELECT * FROM order_items WHERE order_id = $1", [orderId]);
  return toOrder(orderRow, itemRows.map(toOrderItem));
}

export async function createOrderTransactional(
  userId: string,
  idempotencyKey: string,
  shippingAddress: Omit<Address, "id" | "userId">,
  paymentMethodId: string,
  transportPaymentNumber: string | null,
  requestFingerprint: string,
  deliveryLocation: "dar_es_salaam" | "outside_dar",
  directItems?: ReadonlyArray<{ variantId: string; quantity: number }> | null,
  couponCode?: string | null
): Promise<Order> {
  try {
    return await withTransaction(async (client: PoolClient) => {
      // 1. Claim the idempotency key — the FIRST thing in the transaction,
      // before any other work, so a duplicate/replayed request is rejected
      // as cheaply as possible.
      try {
        await client.query(
          `INSERT INTO idempotency_keys (scope, user_id, idempotency_key, status, request_fingerprint)
           VALUES ('order.create', $1, $2, 'IN_PROGRESS', $3)`,
          [userId, idempotencyKey, requestFingerprint]
        );
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
          throw new IdempotencyKeyClaimConflict();
        }
        throw err;
      }

      // 2. Determine the line source. Normal checkout ("buy from your cart")
      // reads the caller's server-side cart. "Buy it now" — a checkout that
      // must contain EXACTLY one product and never touch the rest of the
      // cart — instead uses the explicit items the customer just clicked
      // (variant + quantity), validated exactly the same way below and with
      // the same locking/totals/idempotency guarantees.
      const fromCart = !(directItems && directItems.length > 0);
      let sourceRows: { variant_id: string; quantity: number }[];
      if (fromCart) {
        const cartResult = await client.query<{ variant_id: string; quantity: number }>(
          "SELECT variant_id, quantity FROM cart_items WHERE user_id = $1",
          [userId]
        );
        sourceRows = cartResult.rows;
      } else {
        sourceRows = directItems!.map((i) => ({ variant_id: i.variantId, quantity: i.quantity }));
      }
      if (sourceRows.length === 0) {
        throw new ValidationError("Your cart is empty.");
      }

      const variantIds = [...new Set(sourceRows.map((r) => r.variant_id))].sort();

      // 3. Lock every involved variant row, in a STABLE sorted order, for
      // the remainder of this transaction. This is the real inventory
      // concurrency control — no other transaction can read-for-update or
      // write these rows until this one commits or rolls back.
      const variantResult = await client.query<{
        id: string; stock_qty: number; product_id: string; name: string;
        price_cents: number; active: boolean; brand_name: string; size: string; color: string;
      }>(
        `SELECT pv.id, pv.stock_qty, pv.product_id, p.name, p.price_cents, p.active, b.name AS brand_name, pv.size, pv.color
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         JOIN brands b ON b.id = p.brand_id
         WHERE pv.id = ANY($1::uuid[])
         ORDER BY pv.id
         FOR UPDATE OF pv`,
        [variantIds]
      );
      const variantById = new Map(variantResult.rows.map((r) => [r.id, r]));

      // 4. Validate every line BEFORE mutating anything (all-or-nothing).
      const lines: OrderItem[] = [];
      for (const sourceRow of sourceRows) {
        const v = variantById.get(sourceRow.variant_id);
        if (!v || !v.active) {
          throw new ConflictError("An item in your order is no longer available.");
        }
        if (v.stock_qty < sourceRow.quantity) {
          throw new ConflictError(
            fromCart
              ? `Only ${v.stock_qty} left of ${v.name} (${v.size}) — please update your cart.`
              : `Only ${v.stock_qty} left of ${v.name} (${v.size}) — please reduce the quantity.`
          );
        }
        lines.push({
          productId: v.product_id,
          variantId: v.id,
          nameSnapshot: v.name,
          brandSnapshot: v.brand_name,
          size: v.size,
          color: v.color,
          unitPriceCentsSnapshot: v.price_cents,
          quantity: sourceRow.quantity,
          lineTotalCents: v.price_cents * sourceRow.quantity,
        });
      }

      // 5. Server-authoritative totals — never derived from client input.
      // Delivery cost is the transport fee for the customer's chosen
      // DELIVERY LOCATION (Dar es Salaam vs outside), applied the same way
      // regardless of payment method — a prior version tied this fee to
      // the CASH payment method specifically (Online Pay had zero delivery
      // charge), which is no longer the model: the checkout redesign
      // requires the same fee for a given location whichever payment
      // method is chosen. See migration 0047's header comment.
      const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
      // Real coupon validation + discount computation, replacing the
      // previous hardcoded 0 — see coupons.repo.ts's
      // applyCouponWithinTransaction for why this specific function (not
      // a pre-check before this transaction started) is what makes usage
      // limits race-safe under concurrent checkouts.
      let discountCents = 0;
      let appliedCouponId: string | null = null;
      if (couponCode) {
        const applied = await couponsRepo.applyCouponWithinTransaction(client, couponCode, userId, subtotalCents);
        discountCents = applied.discountCents;
        appliedCouponId = applied.couponId;
      }

      // 5a. Resolve the chosen payment method inside this transaction (so a
      // concurrent deactivation/rename can never make us accept a stale
      // method). The method's label/number are snapshotted onto the order
      // so later edits never rewrite a past order's payment record.
      const pmResult = await client.query<{
        kind: Order["paymentMethodKind"];
        name: string;
        payment_number: string | null;
        is_active: boolean;
      }>(
        "SELECT kind, name, payment_number, is_active FROM payment_methods WHERE id = $1",
        [paymentMethodId]
      );
      const pm = pmResult.rows[0];
      if (!pm) throw new ValidationError("The selected payment method is no longer available.");
      if (!pm.is_active) throw new ValidationError("The selected payment method is currently unavailable.");
      if (pm.kind !== "CASH" && pm.kind !== "ONLINE") throw new ValidationError("Invalid payment method.");

      // 5b. Resolve the transport fee from the customer's chosen delivery
      // location — fetched inside this same transaction (same reasoning
      // as the payment method above: a concurrent admin fee change can
      // never produce a mismatch between what the customer was quoted and
      // what gets charged).
      if (deliveryLocation !== "dar_es_salaam" && deliveryLocation !== "outside_dar") {
        throw new ValidationError("Validation failed.", { deliveryLocation: "Select a valid delivery location." });
      }
      const feeResult = await client.query<{ dar_es_salaam_fee_tzs: number; outside_dar_fee_tzs: number }>(
        "SELECT dar_es_salaam_fee_tzs, outside_dar_fee_tzs FROM platform_settings WHERE id = 1"
      );
      const feeRow = feeResult.rows[0];
      const transportFeeTzs = deliveryLocation === "dar_es_salaam"
        ? Number(feeRow?.dar_es_salaam_fee_tzs ?? 0)
        : Number(feeRow?.outside_dar_fee_tzs ?? 0);
      const transportFeeCents = transportFeeTzs;
      // "shipping_cents" stays as a real column (avoids an unnecessary
      // migration) but is now always the transport fee itself — there is
      // no separate generic shipping component added to it anymore.
      const shippingCents = transportFeeCents;
      const totalCents = subtotalCents - discountCents + transportFeeCents;

      // Exact TZS total the customer is told to pay: subtotal + transport,
      // each in whole shillings. Both cents and TZS columns now hold TZS
      // directly, so totalTzs == totalCents.
      const subtotalTzs = subtotalCents;
      const totalTzs = subtotalTzs + transportFeeTzs;

      // Cash-on-delivery with a transport fee requires the customer to first
      // pay that fee through a chosen mobile-money network. Resolve + snapshot
      // that "transport channel" server-side: match against an ACTIVE ONLINE
      // method by its payment number, so a spoofed number can never bypass the
      // network registry, and a later rename/edit can never rewrite an order.
      // Online Pay orders never need this — the transport fee there is just
      // part of the one total already paid through the chosen online method.
      let transportChannel: { number: string; name: string } | null = null;
      if (pm.kind === "CASH" && transportFeeCents > 0) {
        const tp = (transportPaymentNumber ?? "").trim();
        if (!tp) {
          throw new ValidationError("Validation failed.", {
            transportPaymentNumber: "A transport-fee payment network is required for cash on delivery.",
          });
        }
        const ch = await client.query<{ name: string; is_active: boolean }>(
          "SELECT name, is_active FROM payment_methods WHERE kind = 'ONLINE' AND payment_number = $1",
          [tp]
        );
        const channel = ch.rows[0];
        if (!channel) {
          throw new ValidationError("Validation failed.", {
            transportPaymentNumber: "The selected transport-fee payment network is no longer available.",
          });
        }
        if (!channel.is_active) {
          throw new ValidationError("The selected transport-fee payment network is currently unavailable.");
        }
        transportChannel = { number: tp, name: channel.name };
      }

      // 6. Insert the order + its items. The orders table's CHECK
      // constraints (migrations 0005 & 0014) re-verify this arithmetic
      // independently of the JS above.
      const orderInsert = await client.query<OrderRow>(
        `INSERT INTO orders (user_id, status, subtotal_cents, discount_cents, shipping_cents, total_cents,
                             shipping_address_snapshot, payment_method_kind, payment_method_name, payment_number, transport_fee_cents,
                             transport_fee_tzs, total_tzs, transport_payment_number, transport_payment_name, delivery_location)
         VALUES ($1, 'PENDING', $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          userId, subtotalCents, discountCents, shippingCents, totalCents,
          JSON.stringify(shippingAddress), pm.kind, pm.name, pm.payment_number, transportFeeCents,
          transportFeeTzs, totalTzs, transportChannel?.number ?? null, transportChannel?.name ?? null,
          deliveryLocation,
        ]
      );
      const orderRow = orderInsert.rows[0]!;

      for (const line of lines) {
        await client.query(
          `INSERT INTO order_items
             (order_id, product_id, variant_id, name_snapshot, brand_snapshot, size, color, unit_price_cents_snapshot, quantity, line_total_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            orderRow.id, line.productId, line.variantId, line.nameSnapshot, line.brandSnapshot,
            line.size, line.color, line.unitPriceCentsSnapshot, line.quantity, line.lineTotalCents,
          ]
        );
      }

      // Record the redemption in the SAME transaction as the order that
      // used it — the redemption row and the order it belongs to either
      // both commit or both roll back together, so coupon_redemptions
      // can never reference an order that doesn't actually exist.
      if (appliedCouponId) {
        await couponsRepo.recordRedemption(client, {
          couponId: appliedCouponId,
          userId,
          orderId: orderRow.id,
          discountAppliedCents: discountCents,
        });
      }

      // 7. Decrement stock. The `AND stock_qty >= $2` guard is
      // belt-and-suspenders — unreachable in correct operation given the
      // FOR UPDATE lock + step 4's validation — but if it ever fires
      // anyway (e.g. a future code path forgets the lock), it fails loudly
      // (rowCount 0 -> error -> full rollback) instead of silently
      // allowing negative stock; the `stock_qty >= 0` CHECK constraint
      // would also reject it as a last resort.
      for (const line of lines) {
        const updateResult = await client.query(
          "UPDATE product_variants SET stock_qty = stock_qty - $2, version = version + 1 WHERE id = $1 AND stock_qty >= $2",
          [line.variantId, line.quantity]
        );
        if (updateResult.rowCount === 0) {
          throw new ConflictError("Inventory changed while processing your order — please try again.");
        }
      }

      // 8. Empty the cart lines this order consumed — but ONLY when the
      // order was placed from the cart. A "buy it now" order is created
      // from an explicit item list and must leave the customer's cart
      // completely untouched (that's the whole point of the feature).
      if (fromCart) {
        await client.query("DELETE FROM cart_items WHERE user_id = $1 AND variant_id = ANY($2::uuid[])", [
          userId,
          variantIds,
        ]);
      }

      const order = toOrder(orderRow, lines);

      // 9. Audit + 10. mark idempotency key completed — both inside the
      // same transaction, so they're atomic with everything above.
      await recordAuditEventOnClient(client, {
        actorId: userId,
        actorRole: "CUSTOMER",
        action: "order.created",
        targetType: "order",
        targetId: order.id,
        metadata: { totalCents: order.totalCents, itemCount: lines.length },
      });

      await client.query(
        `UPDATE idempotency_keys SET status = 'COMPLETED', response_body = $3::jsonb
         WHERE scope = 'order.create' AND user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey, JSON.stringify(order)]
      );

      return order;
    });
  } catch (err) {
    if (err instanceof IdempotencyKeyClaimConflict) {
      // The claiming transaction (ours) already rolled back — look up the
      // WINNING attempt's row with a fresh query.
      const existing = await queryOne<{ status: string; response_body: Order | null; request_fingerprint: string | null }>(
        `SELECT status, response_body, request_fingerprint FROM idempotency_keys
         WHERE scope = 'order.create' AND user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey]
      );
      // The key matches, but the actual request doesn't — this is NOT a
      // replay of the same checkout attempt, it's a different request that
      // happens to reuse the same key (a client bug, or a key generated
      // too broadly/reused across genuinely different submissions). Reject
      // explicitly rather than silently handing back the ORIGINAL
      // request's order for a request that asked for something else
      // (different shipping address, different payment method, etc.).
      if (existing?.request_fingerprint && existing.request_fingerprint !== requestFingerprint) {
        throw new ValidationError(
          "This idempotency key was already used for a different request. Use a new key for a new checkout attempt."
        );
      }
      if (existing?.status === "COMPLETED" && existing.response_body) {
        return existing.response_body;
      }
      throw new ConflictError("This request is already being processed.");
    }
    throw err;
  }
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  return fetchOrderWithItems(orderId);
}

export async function listOrdersForUser(userId: string): Promise<Order[]> {
  const orderRows = await query<OrderRow>(
    "SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  if (orderRows.length === 0) return [];
  const itemRows = await query<OrderItemRow>(
    "SELECT * FROM order_items WHERE order_id = ANY($1::uuid[])",
    [orderRows.map((o) => o.id)]
  );
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const row of itemRows) {
    const list = itemsByOrder.get(row.order_id) ?? [];
    list.push(toOrderItem(row));
    itemsByOrder.set(row.order_id, list);
  }
  return orderRows.map((row) => toOrder(row, itemsByOrder.get(row.id) ?? []));
}

export async function listAllOrders(): Promise<Order[]> {
  const orderRows = await query<OrderRow>("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500");
  if (orderRows.length === 0) return [];
  const itemRows = await query<OrderItemRow>(
    "SELECT * FROM order_items WHERE order_id = ANY($1::uuid[])",
    [orderRows.map((o) => o.id)]
  );
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const row of itemRows) {
    const list = itemsByOrder.get(row.order_id) ?? [];
    list.push(toOrderItem(row));
    itemsByOrder.set(row.order_id, list);
  }
  return orderRows.map((row) => toOrder(row, itemsByOrder.get(row.id) ?? []));
}

const VALID_TRANSITIONS: Record<Order["status"], Order["status"][]> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export async function updateOrderStatusTransactional(
  orderId: string,
  nextStatus: Order["status"],
  actor: { id: string; role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN" }
): Promise<Order> {
  return withTransaction(async (client) => {
    const current = await client.query<OrderRow>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const orderRow = current.rows[0];
    if (!orderRow) throw new ConflictError("Order not found.");

    const allowed = VALID_TRANSITIONS[orderRow.status];
    if (!allowed.includes(nextStatus)) {
      throw new ConflictError(`Cannot move order from ${orderRow.status} to ${nextStatus}.`);
    }

    const updated = await client.query<OrderRow>(
      "UPDATE orders SET status = $2 WHERE id = $1 RETURNING *",
      [orderId, nextStatus]
    );

    if (nextStatus === "CANCELLED") {
      const itemsResult = await client.query<OrderItemRow>("SELECT * FROM order_items WHERE order_id = $1", [orderId]);
      for (const item of itemsResult.rows) {
        if (!item.variant_id) continue; // variant was later hard-deleted (SET NULL) — nothing to restock
        await client.query("UPDATE product_variants SET stock_qty = stock_qty + $2 WHERE id = $1", [
          item.variant_id,
          item.quantity,
        ]);
      }
    }

    await recordAuditEventOnClient(client, {
      actorId: actor.id,
      actorRole: actor.role,
      action: "order.status_updated",
      targetType: "order",
      targetId: orderId,
      metadata: { from: orderRow.status, to: nextStatus },
    });

    const itemRows = await client.query<OrderItemRow>("SELECT * FROM order_items WHERE order_id = $1", [orderId]);
    return toOrder(updated.rows[0]!, itemRows.rows.map(toOrderItem));
  });
}
